import { WIKI_BODY_MAX, wikiLinks, wikiSlug, type WikiChange, type WikiInfo, type WikiPageSummary, type WikiPageView, type WikiRevisionView, type WikiSearchHit } from '@app/shared';
import type { Ctx, SessionUser } from './accounts';
import { audit } from './audit';
import type { Viewer } from './boards';
import { newId } from './crypto';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { liveAll } from './live';
import { normalizeBody } from './text';

// The wiki (docs/20, decided 2026-10-05). One for the site, and one each ring can switch on.
// - Anyone can read the site wiki and an enabled ring wiki, as they can a public or ring board.
// - Trusted people and admins edit the site wiki; a ring's wiki is edited by its trusted members, its ops and admins.
//   Protected pages: admins (and for a ring, its ops) only.
// - Every save is a revision. An edit says which revision it started from; if someone saved in between, it is refused
//   with theirs (409 edit_conflict) and the person merges by hand. Nothing is overwritten or merged behind anyone's back.
// - Reverting makes a new revision; renaming leaves a redirect; deleting is soft. Hiding and deleting are audited.

const EDITS_PER_HOUR = 120;

interface Wiki { id: string; ref: string; scope: 'site' | 'ring'; ringId: string | null; ringSlug: string | null; ringName: string | null; enabled: boolean }

const notFound = () => new ApiError(404, 'not_found', 'There is no such page.');
const noWiki = () => new ApiError(404, 'not_found', 'There is no such wiki.');

export async function loadWiki(q: Queryable, v: Viewer, ref: string): Promise<Wiki> {
  if (ref === 'site') {
    const r = (await q.query<{ id: string; enabled: boolean }>(`SELECT id, enabled FROM wikis WHERE scope_type = 'site'`)).rows[0]!;
    return { id: r.id, ref, scope: 'site', ringId: null, ringSlug: null, ringName: null, enabled: true };
  }
  const slug = ref.startsWith('ring:') ? ref.slice(5) : '';
  const r = (await q.query<{ ring_id: string; slug: string; name: string; hidden_at: Date | null; wiki_id: string | null; enabled: boolean | null }>(
    `SELECT r.id AS ring_id, r.slug, r.name, r.hidden_at, w.id AS wiki_id, w.enabled FROM rings r LEFT JOIN wikis w ON w.ring_id = r.id WHERE r.slug = $1`, [slug])).rows[0];
  if (!r || (r.hidden_at && v?.role !== 'admin')) throw noWiki();
  const w: Wiki = { id: r.wiki_id ?? '', ref: `ring:${r.slug}`, scope: 'ring', ringId: r.ring_id, ringSlug: r.slug, ringName: r.name, enabled: Boolean(r.wiki_id && r.enabled) };
  // A ring wiki that is off is there only for those who could switch it on.
  if (!w.enabled && !isModerator(v, w)) throw noWiki();
  return w;
}

const isModerator = (v: Viewer, w: Pick<Wiki, 'scope' | 'ringId'>) =>
  Boolean(v && !v.limited && (v.role === 'admin' || (w.scope === 'ring' && w.ringId && v.ops.includes(`ring:${w.ringId}`))));

async function isEditor(q: Queryable, v: Viewer, w: Wiki): Promise<boolean> {
  if (!v || v.limited || !w.enabled) return false;
  if (isModerator(v, w)) return true;
  if (v.role !== 'trusted') return false;
  if (w.scope === 'site') return true;
  return (await q.query(`SELECT 1 FROM ring_members WHERE ring_id = $1 AND user_id = $2 AND status = 'member'`, [w.ringId, v.userId])).rowCount > 0;
}

export async function wikiInfo(deps: AppDeps, v: Viewer, ref: string): Promise<WikiInfo> {
  const w = await loadWiki(deps.db, v, ref);
  return {
    ref: w.ref, scope: w.scope, enabled: w.enabled, ring: w.ringSlug ? { slug: w.ringSlug, name: w.ringName! } : null,
    can_edit: await isEditor(deps.db, v, w), can_moderate: isModerator(v, w),
  };
}

// A ring's ops switch its wiki on and off. Turning it off keeps every page; turning it back on brings them back.
export async function setRingWiki(deps: AppDeps, v: SessionUser, ringSlug: string, enabled: boolean, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const w = await loadWiki(q, v, `ring:${ringSlug}`).catch(() => { throw noWiki(); });
    if (!isModerator(v, w)) throw new ApiError(403, 'forbidden', 'Only the ring’s ops and admins can do that.');
    if (w.id) await q.query(`UPDATE wikis SET enabled = $2 WHERE id = $1`, [w.id, enabled]);
    else await q.query(`INSERT INTO wikis (id, scope_type, ring_id, enabled) VALUES ($1, 'ring', $2, $3)`, [newId('wk'), w.ringId, enabled]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: enabled ? 'wiki.enabled' : 'wiki.disabled', targetType: 'ring', targetId: w.ringId!, origin: 'web', ipHash: ctx.ipHash });
  });
}

interface PageRow {
  id: string; slug: string; title: string; body: string; revision: number; protected: boolean; created_at: Date; updated_at: Date;
  updated_by: string | null; updater_handle: string | null; hidden_at: Date | null; deleted_at: Date | null; created_by: string | null;
}
const PAGE_COLS = `p.id, p.slug, p.title, p.body, p.revision, p.protected, p.created_at, p.updated_at, p.updated_by, u.handle AS updater_handle, p.hidden_at, p.deleted_at, p.created_by`;

// The page by its slug or an old name of it. A hidden or deleted page is there only for moderators.
async function findPage(q: Queryable, v: Viewer, w: Wiki, slug: string, opts: { forUpdate?: boolean } = {}): Promise<{ page: PageRow | null; redirectedFrom: string | null }> {
  if (!w.id) return { page: null, redirectedFrom: null };
  const lock = opts.forUpdate ? ' FOR UPDATE OF p' : '';
  let r = await q.query<PageRow>(`SELECT ${PAGE_COLS} FROM wiki_pages p LEFT JOIN users u ON u.id = p.updated_by WHERE p.wiki_id = $1 AND p.slug = $2${lock}`, [w.id, slug]);
  let redirectedFrom: string | null = null;
  if (!r.rows[0]) {
    r = await q.query<PageRow>(`SELECT ${PAGE_COLS} FROM wiki_redirects x JOIN wiki_pages p ON p.id = x.page_id LEFT JOIN users u ON u.id = p.updated_by WHERE x.wiki_id = $1 AND x.slug = $2${lock}`, [w.id, slug]);
    if (r.rows[0]) redirectedFrom = slug;
  }
  const page = r.rows[0] ?? null;
  if (page && (page.hidden_at || page.deleted_at) && !isModerator(v, w)) return { page: null, redirectedFrom: null };
  return { page, redirectedFrom };
}

async function view(q: Queryable, v: Viewer, w: Wiki, p: PageRow, redirectedFrom: string | null): Promise<WikiPageView> {
  const links = await q.query<{ target_slug: string; target_title: string; exists: boolean }>(
    `SELECT l.target_slug, l.target_title,
            EXISTS (SELECT 1 FROM wiki_pages t WHERE t.wiki_id = $2 AND t.slug = l.target_slug AND t.deleted_at IS NULL AND t.hidden_at IS NULL)
         OR EXISTS (SELECT 1 FROM wiki_redirects x WHERE x.wiki_id = $2 AND x.slug = l.target_slug) AS exists
       FROM wiki_links l WHERE l.page_id = $1 ORDER BY l.target_slug`, [p.id, w.id]);
  const editor = await isEditor(q, v, w);
  return {
    id: p.id, slug: p.slug, title: p.title, body: p.body, revision: p.revision, protected: p.protected,
    created_at: p.created_at.toISOString(), updated_at: p.updated_at.toISOString(),
    updated_by: p.updated_by && p.updater_handle ? { id: p.updated_by, handle: p.updater_handle } : null,
    hidden: p.hidden_at !== null, deleted: p.deleted_at !== null,
    can_edit: editor && !p.deleted_at && (!p.protected || isModerator(v, w)),
    redirected_from: redirectedFrom,
    links: links.rows.map((l) => ({ slug: l.target_slug, title: l.target_title, exists: l.exists })),
  };
}

export async function getPage(deps: AppDeps, v: Viewer, ref: string, slug: string): Promise<WikiPageView> {
  const w = await loadWiki(deps.db, v, ref);
  const { page, redirectedFrom } = await findPage(deps.db, v, w, slug);
  if (!page) throw notFound();
  return view(deps.db, v, w, page, redirectedFrom);
}

export async function listPages(deps: AppDeps, v: Viewer, ref: string): Promise<WikiPageSummary[]> {
  const w = await loadWiki(deps.db, v, ref);
  if (!w.id) return [];
  const r = await deps.db.query<{ slug: string; title: string; updated_at: Date; revision: number }>(
    `SELECT slug, title, updated_at, revision FROM wiki_pages WHERE wiki_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY lower(title) LIMIT 5000`, [w.id]);
  return r.rows.map((p) => ({ slug: p.slug, title: p.title, updated_at: p.updated_at.toISOString(), revision: p.revision }));
}

const conflict = (current: WikiPageView) => Object.assign(new ApiError(409, 'edit_conflict', 'Someone saved this page while you were editing. Your text is kept; compare it with theirs.'), { details: { current } });

async function writeRevision(q: Queryable, v: SessionUser, w: Wiki, page: { id: string; revision: number }, title: string, body: string, summary: string, revertedTo: number | null): Promise<number> {
  const next = page.revision + 1;
  await q.query(`INSERT INTO wiki_revisions (id, page_id, revision, editor_id, title, body, summary, reverted_to) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [newId('wr'), page.id, next, v.userId, title, body, summary, revertedTo]);
  await q.query(`UPDATE wiki_pages SET title = $2, body = $3, revision = $4, updated_by = $5, updated_at = now() WHERE id = $1`, [page.id, title, body, next, v.userId]);
  await relink(q, page.id, body);
  return next;
}

async function relink(q: Queryable, pageId: string, body: string): Promise<void> {
  await q.query(`DELETE FROM wiki_links WHERE page_id = $1`, [pageId]);
  const links = wikiLinks(body).slice(0, 500);
  if (links.length) {
    await q.query(`INSERT INTO wiki_links (page_id, target_slug, target_title) SELECT $1, s, t FROM unnest($2::text[], $3::text[]) AS x(s, t) ON CONFLICT DO NOTHING`,
      [pageId, links.map((l) => l.slug), links.map((l) => l.target.slice(0, 120))]);
  }
}

async function mayEdit(q: Queryable, v: SessionUser, w: Wiki, page: Pick<PageRow, 'protected' | 'deleted_at'> | null): Promise<void> {
  if (!(await isEditor(q, v, w))) {
    throw new ApiError(403, 'forbidden', w.scope === 'site' ? 'Only trusted people and admins can edit this wiki.' : 'Only the ring’s trusted members and ops can edit its wiki.');
  }
  if (page?.protected && !isModerator(v, w)) throw new ApiError(403, 'protected', 'This page is protected. Only admins and ops can edit it.');
  if (page?.deleted_at) throw new ApiError(409, 'deleted', 'This page was deleted. An admin or op can restore it.');
  const n = Number((await q.query<{ n: string }>(`SELECT count(*) AS n FROM wiki_revisions WHERE editor_id = $1 AND created_at > now() - interval '1 hour'`, [v.userId])).rows[0]!.n);
  if (n >= EDITS_PER_HOUR) throw new ApiError(429, 'rate_limited', 'You have made a lot of edits this hour. Take a break and come back.');
}

const tell = (w: Wiki, slug: string, revision: number) => liveAll({ type: 'wiki', wiki: w.ref, slug, revision });

// Creating (base_revision 0) or editing a page. The title may change only in case and punctuation here; a new name is a rename.
export async function savePage(deps: AppDeps, v: SessionUser, ref: string, slug: string, input: { title: string; body: string; base_revision: number; summary: string }): Promise<WikiPageView> {
  const body = normalizeBody(input.body, { max: WIKI_BODY_MAX, what: 'A wiki page' });
  const title = input.title.replace(/\s+/gu, ' ').trim();
  if (wikiSlug(title) !== slug) throw new ApiError(400, 'title_mismatch', 'That title belongs to a different page. To give this page a new name, rename it.');
  const out = await deps.db.tx(async (q) => {
    let w = await loadWiki(q, v, ref);
    if (!w.enabled) throw noWiki();
    const { page } = await findPage(q, v, w, slug, { forUpdate: true });
    await mayEdit(q, v, w, page);
    if (!page) {
      if (input.base_revision !== 0) throw new ApiError(409, 'gone', 'This page no longer exists. Saving will start it again.');
      if (!w.id) throw noWiki();
      const id = newId('wp');
      await q.query(`INSERT INTO wiki_pages (id, wiki_id, slug, title, body, revision, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, 1, $6, $6)`, [id, w.id, slug, title, body, v.userId]);
      await q.query(`INSERT INTO wiki_revisions (id, page_id, revision, editor_id, title, body, summary) VALUES ($1, $2, 1, $3, $4, $5, $6)`, [newId('wr'), id, v.userId, title, body, input.summary]);
      await q.query(`DELETE FROM wiki_redirects WHERE wiki_id = $1 AND slug = $2`, [w.id, slug]); // a new page wins over an old name
      await relink(q, id, body);
      w = { ...w };
      return { w, slug, revision: 1 };
    }
    if (page.slug !== slug) throw new ApiError(409, 'renamed', `This page is now called "${page.title}". Edit it there.`);
    if (input.base_revision !== page.revision) throw conflict(await view(q, v, w, page, null));
    if (page.body === body && page.title === title) return { w, slug, revision: page.revision }; // nothing changed: no empty revision
    return { w, slug, revision: await writeRevision(q, v, w, page, title, body, input.summary, null) };
  });
  tell(out.w, out.slug, out.revision);
  return getPage(deps, v, ref, slug);
}

export async function history(deps: AppDeps, v: Viewer, ref: string, slug: string): Promise<WikiRevisionView[]> {
  const w = await loadWiki(deps.db, v, ref);
  const { page } = await findPage(deps.db, v, w, slug);
  if (!page) throw notFound();
  const r = await deps.db.query<RevRow>(`SELECT ${REV_COLS} FROM wiki_revisions r LEFT JOIN users u ON u.id = r.editor_id WHERE r.page_id = $1 ORDER BY r.revision DESC LIMIT 1000`, [page.id]);
  return r.rows.map((x) => revView(x, false, isModerator(v, w)));
}

interface RevRow { id: string; revision: number; title: string; body: string; summary: string; editor_id: string | null; handle: string | null; created_at: Date; reverted_to: number | null; text_hidden_at: Date | null }
const REV_COLS = `r.id, r.revision, r.title, r.body, r.summary, r.editor_id, u.handle, r.created_at, r.reverted_to, r.text_hidden_at`;
const revView = (x: RevRow, withBody: boolean, moderator: boolean): WikiRevisionView => ({
  id: x.id, revision: x.revision, title: x.title,
  body: withBody && (!x.text_hidden_at || moderator) ? x.body : null,
  summary: x.text_hidden_at && !moderator ? '' : x.summary,
  editor: x.editor_id && x.handle ? { id: x.editor_id, handle: x.handle } : null,
  created_at: x.created_at.toISOString(), reverted_to: x.reverted_to, text_hidden: x.text_hidden_at !== null,
});

export async function getRevision(deps: AppDeps, v: Viewer, ref: string, slug: string, revision: number): Promise<WikiRevisionView> {
  const w = await loadWiki(deps.db, v, ref);
  const { page } = await findPage(deps.db, v, w, slug);
  if (!page) throw notFound();
  const r = await deps.db.query<RevRow>(`SELECT ${REV_COLS} FROM wiki_revisions r LEFT JOIN users u ON u.id = r.editor_id WHERE r.page_id = $1 AND r.revision = $2`, [page.id, revision]);
  if (!r.rows[0]) throw new ApiError(404, 'not_found', 'There is no such revision.');
  return revView(r.rows[0], true, isModerator(v, w));
}

// Puts an older revision's text back as a new revision, so the history shows what happened.
export async function revert(deps: AppDeps, v: SessionUser, ref: string, slug: string, to: number, base: number): Promise<WikiPageView> {
  const out = await deps.db.tx(async (q) => {
    const w = await loadWiki(q, v, ref);
    const { page } = await findPage(q, v, w, slug, { forUpdate: true });
    if (!page || page.slug !== slug) throw notFound();
    await mayEdit(q, v, w, page);
    if (base !== page.revision) throw conflict(await view(q, v, w, page, null));
    const old = (await q.query<{ title: string; body: string; text_hidden_at: Date | null }>(`SELECT title, body, text_hidden_at FROM wiki_revisions WHERE page_id = $1 AND revision = $2`, [page.id, to])).rows[0];
    if (!old) throw new ApiError(404, 'not_found', 'There is no such revision.');
    if (old.text_hidden_at) throw new ApiError(409, 'hidden', 'That revision’s text is hidden and can’t be put back.');
    if (wikiSlug(old.title) !== page.slug) throw new ApiError(409, 'renamed', 'That revision had a different name. Rename the page back first.');
    return { w, revision: await writeRevision(q, v, w, page, old.title, old.body, `Reverted to revision ${to}`, to) };
  });
  tell(out.w, slug, out.revision);
  return getPage(deps, v, ref, slug);
}

// A new name. The old address keeps working as a redirect; the history gets a revision saying so.
export async function rename(deps: AppDeps, v: SessionUser, ref: string, slug: string, newTitle: string, base: number): Promise<WikiPageView> {
  const title = newTitle.replace(/\s+/gu, ' ').trim();
  const to = wikiSlug(title);
  if (!to) throw new ApiError(400, 'bad_title', 'A page name needs letters or digits.');
  const out = await deps.db.tx(async (q) => {
    const w = await loadWiki(q, v, ref);
    const { page } = await findPage(q, v, w, slug, { forUpdate: true });
    if (!page || page.slug !== slug) throw notFound();
    await mayEdit(q, v, w, page);
    if (base !== page.revision) throw conflict(await view(q, v, w, page, null));
    if (to !== slug) {
      const taken = await q.query(`SELECT 1 FROM wiki_pages WHERE wiki_id = $1 AND slug = $2 UNION ALL SELECT 1 FROM wiki_redirects WHERE wiki_id = $1 AND slug = $2 AND page_id <> $3`, [w.id, to, page.id]);
      if (taken.rowCount) throw new ApiError(409, 'taken', 'There is already a page with that name.');
      await q.query(`DELETE FROM wiki_redirects WHERE wiki_id = $1 AND slug = $2`, [w.id, to]);
      await q.query(`UPDATE wiki_pages SET slug = $2 WHERE id = $1`, [page.id, to]);
      await q.query(`INSERT INTO wiki_redirects (wiki_id, slug, page_id) VALUES ($1, $2, $3) ON CONFLICT (wiki_id, slug) DO UPDATE SET page_id = EXCLUDED.page_id`, [w.id, slug, page.id]);
    }
    return { w, revision: await writeRevision(q, v, w, page, title, page.body, `Renamed from "${page.title}"`, null) };
  });
  tell(out.w, to, out.revision);
  return getPage(deps, v, ref, to);
}

// Moderators' tools: protect, hide (with a reason), delete and restore. All audited.
export async function moderate(deps: AppDeps, v: SessionUser, ref: string, slug: string, action: 'protect' | 'unprotect' | 'hide' | 'unhide' | 'delete' | 'restore', reason: string, ctx: Ctx): Promise<WikiPageView> {
  await deps.db.tx(async (q) => {
    const w = await loadWiki(q, v, ref);
    if (!isModerator(v, w)) throw new ApiError(403, 'forbidden', 'Only admins and ops can do that.');
    const { page } = await findPage(q, v, w, slug, { forUpdate: true });
    if (!page) throw notFound();
    const set = { protect: 'protected = true', unprotect: 'protected = false', hide: 'hidden_at = now()', unhide: 'hidden_at = NULL', delete: 'deleted_at = now()', restore: 'deleted_at = NULL' }[action];
    await q.query(`UPDATE wiki_pages SET ${set} WHERE id = $1`, [page.id]);
    if (action === 'hide' || action === 'delete') {
      await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = $3 WHERE target_type = 'wiki_page' AND target_id = $1 AND status = 'open'`, [page.id, v.userId, `page ${action === 'hide' ? 'hidden' : 'deleted'}`]);
    }
    const name = { protect: 'wiki.page_protected', unprotect: 'wiki.page_unprotected', hide: 'wiki.page_hidden', unhide: 'wiki.page_restored', delete: 'wiki.page_deleted', restore: 'wiki.page_restored' }[action];
    await audit(q, { actorId: v.userId, actorKind: 'user', action: name, targetType: 'wiki_page', targetId: page.id, before: { wiki: w.ref, slug: page.slug, title: page.title }, after: { action, reason }, origin: 'web', ipHash: ctx.ipHash });
  });
  return getPage(deps, v, ref, slug);
}

// Keeps one revision's text from view (someone's address, something illegal). The current text can't be hidden this
// way: revert it first, so the page itself no longer shows it.
export async function hideRevision(deps: AppDeps, v: SessionUser, ref: string, slug: string, revision: number, hidden: boolean, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const w = await loadWiki(q, v, ref);
    if (!isModerator(v, w)) throw new ApiError(403, 'forbidden', 'Only admins and ops can do that.');
    const { page } = await findPage(q, v, w, slug, { forUpdate: true });
    if (!page) throw notFound();
    if (hidden && revision === page.revision) throw new ApiError(409, 'current', 'This is the page’s current text. Revert to an earlier revision first, then hide this one.');
    const r = await q.query(`UPDATE wiki_revisions SET text_hidden_at = ${hidden ? 'now()' : 'NULL'} WHERE page_id = $1 AND revision = $2`, [page.id, revision]);
    if (!r.rowCount) throw new ApiError(404, 'not_found', 'There is no such revision.');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: hidden ? 'wiki.revision_hidden' : 'wiki.revision_shown', targetType: 'wiki_page', targetId: page.id, after: { wiki: w.ref, slug: page.slug, revision, reason }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function changes(deps: AppDeps, v: Viewer, ref: string, limit = 100): Promise<WikiChange[]> {
  const w = await loadWiki(deps.db, v, ref);
  if (!w.id) return [];
  const r = await deps.db.query<{ slug: string; title: string; revision: number; summary: string; editor_id: string | null; handle: string | null; created_at: Date; reverted_to: number | null; text_hidden_at: Date | null }>(
    `SELECT p.slug, p.title, r.revision, r.summary, r.editor_id, u.handle, r.created_at, r.reverted_to, r.text_hidden_at
       FROM wiki_revisions r JOIN wiki_pages p ON p.id = r.page_id LEFT JOIN users u ON u.id = r.editor_id
      WHERE p.wiki_id = $1 AND p.deleted_at IS NULL AND p.hidden_at IS NULL
      ORDER BY r.created_at DESC, r.revision DESC LIMIT $2`, [w.id, Math.min(limit, 500)]);
  return r.rows.map((x) => ({
    page: { slug: x.slug, title: x.title }, revision: x.revision, summary: x.text_hidden_at ? '' : x.summary,
    editor: x.editor_id && x.handle ? { id: x.editor_id, handle: x.handle } : null, created_at: x.created_at.toISOString(), reverted_to: x.reverted_to, created: x.revision === 1,
  }));
}

// Pages people link to that don't exist yet, most wanted first.
export async function wanted(deps: AppDeps, v: Viewer, ref: string): Promise<{ slug: string; title: string; count: number }[]> {
  const w = await loadWiki(deps.db, v, ref);
  if (!w.id) return [];
  const r = await deps.db.query<{ target_slug: string; title: string; n: string }>(
    `SELECT l.target_slug, min(l.target_title) AS title, count(*) AS n
       FROM wiki_links l JOIN wiki_pages p ON p.id = l.page_id
      WHERE p.wiki_id = $1 AND p.deleted_at IS NULL AND p.hidden_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM wiki_pages t WHERE t.wiki_id = $1 AND t.slug = l.target_slug AND t.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM wiki_redirects x WHERE x.wiki_id = $1 AND x.slug = l.target_slug)
      GROUP BY l.target_slug ORDER BY count(*) DESC, l.target_slug LIMIT 200`, [w.id]);
  return r.rows.map((x) => ({ slug: x.target_slug, title: x.title, count: Number(x.n) }));
}

export async function linksHere(deps: AppDeps, v: Viewer, ref: string, slug: string): Promise<WikiPageSummary[]> {
  const w = await loadWiki(deps.db, v, ref);
  if (!w.id) return [];
  const { page } = await findPage(deps.db, v, w, slug);
  const slugs = [slug, ...(page ? [page.slug] : []), ...(page ? (await deps.db.query<{ slug: string }>(`SELECT slug FROM wiki_redirects WHERE page_id = $1`, [page.id])).rows.map((x) => x.slug) : [])];
  const r = await deps.db.query<{ slug: string; title: string; updated_at: Date; revision: number }>(
    `SELECT DISTINCT p.slug, p.title, p.updated_at, p.revision FROM wiki_links l JOIN wiki_pages p ON p.id = l.page_id
      WHERE p.wiki_id = $1 AND l.target_slug = ANY($2) AND p.deleted_at IS NULL AND p.hidden_at IS NULL ORDER BY p.title`, [w.id, slugs]);
  return r.rows.map((p) => ({ slug: p.slug, title: p.title, updated_at: p.updated_at.toISOString(), revision: p.revision }));
}

// Search, like the boards': websearch syntax, ranked, with marker characters (\u0002 \u0003) around the matches so the
// snippet is never treated as HTML.
export async function search(deps: AppDeps, v: Viewer, ref: string, q: string): Promise<WikiSearchHit[]> {
  const w = await loadWiki(deps.db, v, ref);
  if (!w.id) return [];
  const r = await deps.db.query<{ slug: string; title: string; snippet: string }>(
    `SELECT slug, title, ts_headline('simple', body, websearch_to_tsquery('simple', $2), 'StartSel=\u0002, StopSel=\u0003, MaxWords=30, MinWords=12, MaxFragments=1') AS snippet
       FROM wiki_pages WHERE wiki_id = $1 AND deleted_at IS NULL AND hidden_at IS NULL AND body_tsv @@ websearch_to_tsquery('simple', $2)
      ORDER BY ts_rank(body_tsv, websearch_to_tsquery('simple', $2)) DESC, title LIMIT 50`, [w.id, q]);
  return r.rows;
}

// Reports go to the admins (scope "site"), as homepages and files do.
export async function reportPage(deps: AppDeps, v: SessionUser, ref: string, slug: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  const w = await loadWiki(deps.db, v, ref);
  const { page } = await findPage(deps.db, v, w, slug);
  if (!page) throw notFound();
  const rid = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, 'wiki_page', $2, 'site', 'site', $3, $4, $5)`, [rid, page.id, v.userId, category, note]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.created', targetType: 'wiki_page', targetId: page.id, after: { category, wiki: w.ref, slug: page.slug }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'reports_one_open') throw new ApiError(409, 'already_reported', 'You already reported this. The admins have it.');
    throw err;
  }
  return { id: rid };
}

// Account deletion (docs/20). Their revisions stay as history, credited to nobody. If they asked for their writing to be
// erased, each revision's text is replaced with a note, and a page whose current text is theirs goes back to the latest
// version by someone else, or is deleted if there is none.
export async function forgetEditor(q: Queryable, userId: string, erase: boolean): Promise<void> {
  if (erase) {
    const pages = (await q.query<{ id: string }>(`SELECT id FROM wiki_pages WHERE updated_by = $1`, [userId])).rows;
    await q.query(`UPDATE wiki_revisions SET body = '[removed at the author’s request]', summary = '' WHERE editor_id = $1`, [userId]);
    for (const { id } of pages) {
      const prev = (await q.query<{ title: string; body: string; editor_id: string | null }>(
        `SELECT title, body, editor_id FROM wiki_revisions WHERE page_id = $1 AND editor_id IS DISTINCT FROM $2 ORDER BY revision DESC LIMIT 1`, [id, userId])).rows[0];
      if (prev) {
        await q.query(`UPDATE wiki_pages SET title = $2, body = $3, updated_by = $4 WHERE id = $1`, [id, prev.title, prev.body, prev.editor_id]);
        await relink(q, id, prev.body);
      } else {
        await q.query(`UPDATE wiki_pages SET deleted_at = COALESCE(deleted_at, now()), body = '' WHERE id = $1`, [id]);
        await q.query(`DELETE FROM wiki_links WHERE page_id = $1`, [id]);
      }
    }
  }
  await q.query(`UPDATE wiki_revisions SET editor_id = NULL WHERE editor_id = $1`, [userId]);
  await q.query(`UPDATE wiki_pages SET created_by = NULL WHERE created_by = $1`, [userId]);
  await q.query(`UPDATE wiki_pages SET updated_by = NULL WHERE updated_by = $1`, [userId]);
}
