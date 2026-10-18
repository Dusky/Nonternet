import sharp from 'sharp';
import { fuzzy, isFuzzy } from './search';
import {
  BOOKMARKS_MAX, BOOKMARK_DESCRIPTION_MAX, BOOKMARK_TITLE_MAX, bookmarkKey,
  type BookmarkPage, type BookmarkView, type BookmarkVisibility, type SharedBookmarkPage, type SharedBookmarkView,
} from '@app/shared';
import type { z } from 'zod';
import { bookmarkCreateSchema, type BookmarkSort, type bookmarkListQuerySchema, type bookmarkUpdateSchema } from '@app/shared';
import type { Ctx, SessionUser } from './accounts';
import { isMember, type Viewer } from './boards';
import { audit } from './audit';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { safeFetch } from './safe-fetch';
import type { Queryable } from './db';

// Bookmarks (docs/21): a person's saved links. The site keeps the address, a title, a description and a small icon. It
// reads the top of the page once to fill those in, keeps only plain text from it, and never keeps a copy of the page.

const PAGE_BYTES = 512 * 1024;     // the title and icon links are near the top
const ICON_BYTES = 200 * 1024;
const ICON_SIZE = 32;

interface Row {
  id: string; url: string; title: string; description: string; tags: string[]; pinned: boolean; visibility: BookmarkVisibility;
  ring_slug: string | null; ring_name: string | null; has_icon: boolean; created_at: Date; updated_at: Date; link_ok: boolean | null; checked_at: Date | null;
  hidden_at: Date | null; hidden_reason: string | null;
}
const COLUMNS = `b.id, b.url, b.title, b.description, b.tags, b.pinned, b.visibility, g.slug AS ring_slug, g.name AS ring_name,
  b.favicon IS NOT NULL AS has_icon, b.created_at, b.updated_at, b.link_ok, b.checked_at, b.hidden_at, b.hidden_reason`;
const FROM = `FROM bookmarks b LEFT JOIN rings g ON g.id = b.ring_id`;

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
// Bookmarks whose page is being read right now, after they were saved (one core process, so memory is enough;
// a restart in between leaves the address as the title, which the person can edit).
const reading = new Set<string>();

const toView = (r: Row): BookmarkView => ({
  id: r.id, url: r.url, title: r.title, description: r.description, tags: r.tags, pinned: r.pinned, visibility: r.visibility,
  ring: r.ring_slug ? { slug: r.ring_slug, name: r.ring_name! } : null, host: hostOf(r.url), has_icon: r.has_icon,
  created_at: r.created_at.toISOString(), updated_at: r.updated_at.toISOString(), link_ok: r.link_ok, checked_at: r.checked_at?.toISOString() ?? null,
  hidden: r.hidden_at ? { reason: r.hidden_reason ?? '' } : null,
  fetching: reading.has(r.id),
});

// What anyone may see (docs/21): shared, not taken down, by someone active, and for a ring bookmark a ring that is not
// hidden. Every read of other people's bookmarks goes through this, so it can't show more than it should.
const SHARED = `b.visibility <> 'private' AND b.hidden_at IS NULL AND u.status = 'active' AND u.role <> 'guest'
  AND (b.visibility = 'public' OR (b.visibility = 'ring' AND g.id IS NOT NULL AND g.hidden_at IS NULL))`;

// Sharing into a ring needs the owner to be in it, and the ring to be open for business.
async function ringFor(q: Queryable, v: SessionUser, slug: string): Promise<string> {
  const r = await q.query<{ id: string }>(
    `SELECT g.id FROM rings g JOIN ring_members m ON m.ring_id = g.id AND m.user_id = $2 AND m.status = 'member'
      WHERE g.slug = $1 AND g.archived_at IS NULL AND g.hidden_at IS NULL`, [slug, v.userId]);
  if (!r.rows[0]) throw new ApiError(403, 'not_in_ring', 'You can only share into a ring you are in.');
  return r.rows[0].id;
}

function mustBeMember(v: SessionUser): void {
  if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
}
const notFound = () => new ApiError(404, 'not_found', 'There is no such bookmark.');

// ---------------------------------------------------------------- reading the page

// Plain text only: entities decoded, tags and control characters gone, spaces squeezed.
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', copy: '©', reg: '®', trade: '™' };
export function plainText(s: string, max: number): string {
  const decoded = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' ';
      }
      return NAMED[e.toLowerCase()] ?? m;
    });
  // eslint-disable-next-line no-control-regex
  const clean = decoded.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...clean].slice(0, max).join('');
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((x) => x !== undefined) ?? null;

export interface PageInfo { title: string; description: string; icons: string[] }
// What a page says about itself, from its HTML. Pure, so it can be tested without the network.
export function readPage(html: string, base: string): PageInfo {
  const head = html.slice(0, PAGE_BYTES);
  // A tag ends at the first > outside quotes.
  const tags = (name: string) => head.match(new RegExp(`<${name}\\b(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi')) ?? [];
  const metas = tags('meta');
  const meta = (...names: string[]) => {
    for (const n of names) {
      for (const m of metas) {
        const key = (attr(m, 'property') ?? attr(m, 'name') ?? '').toLowerCase();
        if (key === n) { const c = attr(m, 'content'); if (c?.trim()) return c; }
      }
    }
    return '';
  };
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  const title = plainText(meta('og:title', 'twitter:title') || titleTag, BOOKMARK_TITLE_MAX);
  const description = plainText(meta('description', 'og:description', 'twitter:description'), BOOKMARK_DESCRIPTION_MAX);
  const icons: { href: string; rank: number }[] = [];
  for (const l of tags('link')) {
    const rel = (attr(l, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr(l, 'href');
    if (!href) continue;
    // Prefer PNG and SVG-free icons near our size; apple-touch icons are always PNG.
    const type = (attr(l, 'type') ?? '').toLowerCase();
    let rank = -1;
    if (rel.includes('icon')) rank = type.includes('svg') || /\.svg(\?|$)/i.test(href) ? -1 : 2;
    if (rel.includes('apple-touch-icon')) rank = 1;
    if (rank < 0) continue;
    try { icons.push({ href: new URL(plainText(href, 2000), base).toString(), rank }); } catch { /* a broken address */ }
  }
  icons.sort((a, b) => b.rank - a.rank);
  let fallback: string | null = null;
  try { fallback = new URL('/favicon.ico', base).toString(); } catch { /* none */ }
  return { title, description, icons: [...new Set([...icons.map((i) => i.href), ...(fallback ? [fallback] : [])])].filter((u) => /^https?:/.test(u)) };
}

// An .ico file is a small directory of pictures. Modern ones hold PNGs, which sharp can read; older bitmap entries are
// skipped (no icon is better than a broken one).
export function pngFromIco(data: Buffer): Buffer | null {
  if (data.length < 6 || data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1) return null;
  const count = data.readUInt16LE(4);
  let best: Buffer | null = null, bestSize = 0;
  for (let i = 0; i < count && 6 + i * 16 + 16 <= data.length; i++) {
    const e = 6 + i * 16;
    const w = data[e] || 256;
    const len = data.readUInt32LE(e + 8), off = data.readUInt32LE(e + 12);
    if (off + len > data.length || len < 8) continue;
    const img = data.subarray(off, off + len);
    if (img.readUInt32BE(0) !== 0x89504e47) continue;
    if (!best || Math.abs(w - ICON_SIZE) < Math.abs(bestSize - ICON_SIZE)) { best = img; bestSize = w; }
  }
  return best;
}

async function iconFrom(data: Buffer): Promise<Buffer | null> {
  const png = pngFromIco(data);
  try {
    const img = sharp(png ?? data, { limitInputPixels: 4_000_000, failOn: 'error' });
    const meta = await img.metadata();
    if (!meta.format || !['png', 'jpeg', 'webp', 'gif'].includes(meta.format)) return null;
    return await img.resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

export interface Fetched { title: string; description: string; icon: Buffer | null }
// Reads the page once. Any failure leaves what it could not find empty; the bookmark is saved anyway.
export async function fetchPage(deps: AppDeps, url: string): Promise<Fetched> {
  const allowPrivate = deps.allowPrivateFetch;
  let info: PageInfo = { title: '', description: '', icons: [] };
  try {
    const f = await safeFetch(url, { maxBytes: PAGE_BYTES, truncate: true, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', allowPrivate, timeoutMs: 8000 });
    if (/html|xml/i.test(f.contentType) || !f.contentType) {
      const charset = /charset=["']?([\w-]+)/i.exec(f.contentType)?.[1] ?? 'utf-8';
      let html: string;
      try { html = new TextDecoder(charset).decode(f.data); } catch { html = f.data.toString('utf8'); }
      info = readPage(html, f.finalUrl);
    } else {
      info = readPage('', f.finalUrl);
    }
  } catch {
    try { info = readPage('', url); } catch { /* no icon either */ }
  }
  let icon: Buffer | null = null;
  for (const href of info.icons.slice(0, 3)) {
    try {
      const f = await safeFetch(href, { maxBytes: ICON_BYTES, accept: 'image/*', allowPrivate, timeoutMs: 5000 });
      icon = await iconFrom(f.data);
      if (icon) break;
    } catch { /* try the next one */ }
  }
  return { title: info.title, description: info.description, icon };
}

// ---------------------------------------------------------------- the person's own bookmarks

export async function getBookmark(deps: AppDeps, v: SessionUser, id: string, q: Queryable = deps.db): Promise<BookmarkView> {
  const r = await q.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.id = $1 AND b.user_id = $2`, [id, v.userId]);
  if (!r.rows[0]) throw notFound();
  return toView(r.rows[0]);
}

// Saves a link. An address they already have (compared without the fragment and tracking parameters) gives back the
// bookmark they have, unchanged, with `existing: true`.
// `fetch`: read the page first (true, the default), not at all (false, for imports), or after saving ('later', for the
// web: the bookmark is there at once and its title, description and icon arrive a moment after).
export async function addBookmark(deps: AppDeps, v: SessionUser, input: z.infer<typeof bookmarkCreateSchema>, opts: { fetch?: boolean | 'later' } = {}): Promise<{ bookmark: BookmarkView; existing: boolean }> {
  mustBeMember(v);
  const key = bookmarkKey(input.url);
  const had = await deps.db.query<{ id: string }>(`SELECT id FROM bookmarks WHERE user_id = $1 AND url_key = $2`, [v.userId, key]);
  if (had.rows[0]) return { bookmark: await getBookmark(deps, v, had.rows[0].id), existing: true };
  const count = await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM bookmarks WHERE user_id = $1`, [v.userId]);
  if (Number(count.rows[0]!.n) >= BOOKMARKS_MAX) throw new ApiError(409, 'too_many', `You can keep up to ${BOOKMARKS_MAX.toLocaleString('en')} bookmarks. Remove some to add more.`);
  // What the person typed wins; the page fills in the rest.
  const wants = !(input.title && input.description !== undefined);
  const page = opts.fetch === false || opts.fetch === 'later' || !wants ? null : await fetchPage(deps, input.url);
  const ringId = input.visibility === 'ring' ? await ringFor(deps.db, v, input.ring!) : null;
  const id = newId('bm');
  const title = input.title || page?.title || hostOf(input.url) + new URL(input.url).pathname.replace(/\/$/, '');
  try {
    await deps.db.query(
      `INSERT INTO bookmarks (id, user_id, url, url_key, title, description, tags, pinned, visibility, ring_id, favicon) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, v.userId, input.url, key, [...title].slice(0, BOOKMARK_TITLE_MAX).join(''), input.description ?? page?.description ?? '', input.tags, input.pinned, input.visibility, ringId, page?.icon ?? null]);
  } catch (e) {
    // Saved twice at once: give back the one that won.
    if ((e as { code?: string }).code === '23505') {
      const r = await deps.db.query<{ id: string }>(`SELECT id FROM bookmarks WHERE user_id = $1 AND url_key = $2`, [v.userId, key]);
      if (r.rows[0]) return { bookmark: await getBookmark(deps, v, r.rows[0].id), existing: true };
    }
    throw e;
  }
  if (opts.fetch === 'later' && wants) {
    reading.add(id);
    void fillFromPage(deps, id, input, title).finally(() => reading.delete(id));
  }
  return { bookmark: await getBookmark(deps, v, id), existing: false };
}

// The page's title, description and icon, written only where the person didn't type their own and hasn't changed it since.
async function fillFromPage(deps: AppDeps, id: string, input: z.infer<typeof bookmarkCreateSchema>, placeholder: string): Promise<void> {
  try {
    const page = await fetchPage(deps, input.url);
    if (page.title && !input.title) {
      await deps.db.query(`UPDATE bookmarks SET title = $2 WHERE id = $1 AND title = $3`, [id, [...page.title].slice(0, BOOKMARK_TITLE_MAX).join(''), [...placeholder].slice(0, BOOKMARK_TITLE_MAX).join('')]);
    }
    if (page.description && input.description === undefined) await deps.db.query(`UPDATE bookmarks SET description = $2 WHERE id = $1 AND description = ''`, [id, page.description]);
    if (page.icon) await deps.db.query(`UPDATE bookmarks SET favicon = $2 WHERE id = $1 AND favicon IS NULL`, [id, page.icon]);
  } catch { /* the bookmark stays as saved */ }
}

export async function updateBookmark(deps: AppDeps, v: SessionUser, id: string, input: z.infer<typeof bookmarkUpdateSchema>): Promise<BookmarkView> {
  const sets: string[] = [];
  const params: unknown[] = [id, v.userId];
  const set = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (input.url !== undefined) {
    const key = bookmarkKey(input.url);
    const clash = await deps.db.query(`SELECT 1 FROM bookmarks WHERE user_id = $1 AND url_key = $2 AND id <> $3`, [v.userId, key, id]);
    if (clash.rowCount) throw new ApiError(409, 'duplicate', 'You already have a bookmark for that address.');
    set('url', input.url); set('url_key', key);
    sets.push('link_ok = NULL', 'checked_at = NULL');   // a new address has not been checked
  }
  if (input.title !== undefined) set('title', input.title);
  if (input.description !== undefined) set('description', input.description);
  if (input.tags !== undefined) set('tags', input.tags);
  if (input.pinned !== undefined) set('pinned', input.pinned);
  // Naming a ring shares it there; any other choice drops the ring.
  const visibility = input.visibility ?? (input.ring ? 'ring' : undefined);
  if (visibility !== undefined) {
    set('visibility', visibility);
    set('ring_id', visibility === 'ring' ? await ringFor(deps.db, v, input.ring!) : null);
  }
  const r = await deps.db.query(`UPDATE bookmarks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`, params);
  if (!r.rowCount) throw notFound();
  return getBookmark(deps, v, id);
}

export async function deleteBookmark(deps: AppDeps, v: SessionUser, id: string): Promise<void> {
  const r = await deps.db.query(`DELETE FROM bookmarks WHERE id = $1 AND user_id = $2`, [id, v.userId]);
  if (!r.rowCount) throw notFound();
}

// Newest first, or the best matches first when searching. The cursor is the last row's time and id.
export async function listBookmarks(deps: AppDeps, v: SessionUser, query: z.infer<typeof bookmarkListQuerySchema>): Promise<BookmarkPage> {
  const where = ['b.user_id = $1'];
  const params: unknown[] = [v.userId];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
  if (query.tag) add('? = ANY(b.tags)', query.tag);
  if (query.tags?.length) add('b.tags @> ?::text[]', query.tags);
  if (query.pinned !== undefined) add('b.pinned = ?', query.pinned);
  if (query.broken) where.push('b.link_ok = false');
  if (query.q) {
    params.push(query.q);
    const p = `$${params.length}`;
    // The words, or a loose match on the title and address (part of a word, a typo, no accents: docs/14).
    where.push(isFuzzy(query.q) ? `(b.search @@ websearch_to_tsquery('simple', ${p}) OR ${fuzzy(`coalesce(b.title, '') || ' ' || b.url`, p)})` : `b.search @@ websearch_to_tsquery('simple', ${p})`);
  }
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM bookmarks b WHERE ${where.join(' AND ')}`, params)).rows[0]!.n);
  // Each order is a tuple read in one direction, so the cursor is "after this tuple".
  const order = SORTS[query.sort];
  if (query.before) {
    let after: unknown[] | null = null;
    try { after = JSON.parse(Buffer.from(query.before, 'base64url').toString('utf8')) as unknown[]; } catch { /* a bad cursor starts at the top */ }
    if (Array.isArray(after) && after.length === order.cols.length && after.every((x) => typeof x === 'string' || typeof x === 'boolean')) {
      const marks = after.map((x, i) => { params.push(x); return `$${params.length}${order.casts[i]}`; });
      where.push(`(${order.cols.join(', ')}) ${order.desc ? '<' : '>'} (${marks.join(', ')})`);
    }
  }
  params.push(query.limit + 1);
  const dir = order.desc ? 'DESC' : 'ASC';
  const r = await deps.db.query<Row & { sort_key: unknown[] }>(
    `SELECT ${COLUMNS}, json_build_array(${order.cols.join(', ')}) AS sort_key ${FROM} WHERE ${where.join(' AND ')}
      ORDER BY ${order.cols.map((c) => `${c} ${dir}`).join(', ')} LIMIT $${params.length}`, params);
  const rows = r.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return { bookmarks: rows.map(toView), next: r.rows.length > query.limit && last ? Buffer.from(JSON.stringify(last.sort_key)).toString('base64url') : null, total };
}

const SORTS: Record<BookmarkSort, { cols: string[]; casts: string[]; desc: boolean }> = {
  newest: { cols: ['b.created_at', 'b.id'], casts: ['::timestamptz', ''], desc: true },
  oldest: { cols: ['b.created_at', 'b.id'], casts: ['::timestamptz', ''], desc: false },
  title: { cols: ['lower(b.title)', 'b.id'], casts: ['', ''], desc: false },
  pinned: { cols: ['b.pinned', 'b.created_at', 'b.id'], casts: ['::boolean', '::timestamptz', ''], desc: true },
};

// Every bookmark, oldest first, for the browser-file export.
export async function allBookmarks(deps: AppDeps, v: SessionUser): Promise<BookmarkView[]> {
  const r = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.user_id = $1 ORDER BY b.created_at, b.id`, [v.userId]);
  return r.rows.map(toView);
}

// "Check this link" (docs/21): on request only, never automatic. Any answer (after redirects) counts as answering; a refusal,
// an error status, a timeout or an address that leads inside counts as not answering.
export async function checkBookmark(deps: AppDeps, v: SessionUser, id: string): Promise<BookmarkView> {
  const r = await deps.db.query<{ url: string }>(`SELECT url FROM bookmarks WHERE id = $1 AND user_id = $2`, [id, v.userId]);
  if (!r.rows[0]) throw notFound();
  let ok = true;
  try { await safeFetch(r.rows[0].url, { maxBytes: 16 * 1024, truncate: true, accept: '*/*', allowPrivate: deps.allowPrivateFetch, timeoutMs: 8000 }); } catch { ok = false; }
  await deps.db.query(`UPDATE bookmarks SET link_ok = $3, checked_at = now() WHERE id = $1 AND user_id = $2`, [id, v.userId, ok]);
  return getBookmark(deps, v, id);
}

// The home panel's section (docs/21): pinned ones first, then the newest.
export async function hub(deps: AppDeps, v: SessionUser): Promise<{ pinned: BookmarkView[]; recent: BookmarkView[]; total: number }> {
  const pinned = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.user_id = $1 AND b.pinned ORDER BY b.created_at DESC LIMIT 24`, [v.userId]);
  const recent = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE b.user_id = $1 AND NOT b.pinned ORDER BY b.created_at DESC LIMIT 8`, [v.userId]);
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM bookmarks WHERE user_id = $1`, [v.userId])).rows[0]!.n);
  return { pinned: pinned.rows.map(toView), recent: recent.rows.map(toView), total };
}

export async function tagCounts(deps: AppDeps, v: SessionUser): Promise<{ tag: string; count: number }[]> {
  const r = await deps.db.query<{ tag: string; n: string }>(
    `SELECT t AS tag, count(*) AS n FROM bookmarks, unnest(tags) AS t WHERE user_id = $1 GROUP BY t ORDER BY count(*) DESC, t LIMIT 200`, [v.userId]);
  return r.rows.map((x) => ({ tag: x.tag, count: Number(x.n) }));
}

// The owner's icon, or a shared bookmark's for anyone who may see it. `shared` says whether it may be cached publicly.
export async function readIcon(deps: AppDeps, v: Viewer, id: string): Promise<{ data: Buffer; shared: boolean }> {
  const r = await deps.db.query<{ favicon: Buffer | null; shared: boolean }>(
    `SELECT b.favicon, (${SHARED}) AS shared FROM bookmarks b JOIN users u ON u.id = b.user_id LEFT JOIN rings g ON g.id = b.ring_id
      WHERE b.id = $1 AND (b.user_id = $2 OR (${SHARED}))`, [id, v?.userId ?? null]);
  if (!r.rows[0]?.favicon) throw notFound();
  return { data: r.rows[0].favicon, shared: r.rows[0].shared };
}

// ---------------------------------------------------------------- shared bookmarks (docs/21, B3)

// The rings a person may share into: the ones they are in that are open for business.
export async function shareableRings(deps: AppDeps, v: SessionUser): Promise<{ slug: string; name: string }[]> {
  const r = await deps.db.query<{ slug: string; name: string }>(
    `SELECT g.slug, g.name FROM rings g JOIN ring_members m ON m.ring_id = g.id AND m.user_id = $1 AND m.status = 'member'
      WHERE g.archived_at IS NULL AND g.hidden_at IS NULL ORDER BY lower(g.name)`, [v.userId]);
  return r.rows;
}

interface SharedRow {
  id: string; url: string; title: string; description: string; tags: string[]; has_icon: boolean; created_at: Date; visibility: 'public' | 'ring';
  ring_id: string | null; ring_slug: string | null; ring_name: string | null; owner_id: string; handle: string; display_name: string | null;
}
const SHARED_COLUMNS = `b.id, b.url, b.title, b.description, b.tags, b.favicon IS NOT NULL AS has_icon, b.created_at, b.visibility,
  g.id AS ring_id, g.slug AS ring_slug, g.name AS ring_name, u.id AS owner_id, u.handle, u.display_name`;
const SHARED_FROM = `FROM bookmarks b JOIN users u ON u.id = b.user_id LEFT JOIN rings g ON g.id = b.ring_id`;
const canHide = (v: Viewer, ringId: string | null) => Boolean(v && (v.role === 'admin' || (ringId && v.ops.includes(`ring:${ringId}`))));
const toShared = (v: Viewer) => (r: SharedRow): SharedBookmarkView => ({
  id: r.id, url: r.url, title: r.title, description: r.description, tags: r.tags, host: hostOf(r.url), has_icon: r.has_icon,
  created_at: r.created_at.toISOString(), visibility: r.visibility, ring: r.ring_slug ? { slug: r.ring_slug, name: r.ring_name! } : null,
  owner: { id: r.owner_id, handle: r.handle, display_name: r.display_name }, can_hide: canHide(v, r.ring_id),
});

async function sharedPage(deps: AppDeps, v: Viewer, where: string, params: unknown[], before: string | undefined, limit = 50): Promise<SharedBookmarkPage> {
  const all = [...params];
  let cursor = '';
  if (before) {
    const [at, bid] = before.split('|');
    if (at && bid && !Number.isNaN(Date.parse(at))) { all.push(at, bid); cursor = ` AND (b.created_at, b.id) < ($${all.length - 1}::timestamptz, $${all.length})`; }
  }
  all.push(limit + 1);
  const r = await deps.db.query<SharedRow>(`SELECT ${SHARED_COLUMNS} ${SHARED_FROM} WHERE ${SHARED} AND ${where}${cursor} ORDER BY b.created_at DESC, b.id DESC LIMIT $${all.length}`, all);
  const rows = r.rows.slice(0, limit);
  const last = rows.at(-1);
  return { bookmarks: rows.map(toShared(v)), next: r.rows.length > limit && last ? `${last.created_at.toISOString()}|${last.id}` : null };
}

// A person's public bookmarks, for their profile and feed.
export async function publicBookmarks(deps: AppDeps, v: Viewer, handle: string, before?: string, limit?: number): Promise<SharedBookmarkPage> {
  const u = (await deps.db.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1) AND status = 'active' AND role <> 'guest'`, [handle])).rows[0];
  if (!u) throw new ApiError(404, 'not_found', 'Nobody here goes by that name.');
  return sharedPage(deps, v, `b.user_id = $1 AND b.visibility = 'public'`, [u.id], before, limit);
}

// What a ring's members shared into it, for the ring page. Anyone who can see the ring can see these.
export async function ringBookmarks(deps: AppDeps, v: Viewer, slug: string, before?: string): Promise<SharedBookmarkPage> {
  const g = (await deps.db.query<{ id: string }>(`SELECT id FROM rings WHERE slug = $1 AND (hidden_at IS NULL OR $2::boolean)`, [slug, v?.role === 'admin'])).rows[0];
  if (!g) throw new ApiError(404, 'not_found', 'There is no ring by that name.');
  return sharedPage(deps, v, `b.ring_id = $1 AND b.visibility = 'ring'`, [g.id], before);
}

// A shared bookmark someone can see, for reporting and hiding.
async function sharedOne(q: Queryable, id: string, includeHidden: boolean): Promise<{ id: string; ring_id: string | null; board_id: string | null; user_id: string; title: string; url: string } | null> {
  const where = includeHidden ? SHARED.replace('b.hidden_at IS NULL AND ', '') : SHARED;
  const r = await q.query<{ id: string; ring_id: string | null; board_id: string | null; user_id: string; title: string; url: string }>(
    `SELECT b.id, b.ring_id, g.board_id, b.user_id, b.title, b.url ${SHARED_FROM} WHERE b.id = $1 AND ${where}`, [id]);
  return r.rows[0] ?? null;
}

// Reports on a ring bookmark go to that ring's ops (through its board) and the admins; on a public one, to the admins.
export async function reportBookmark(deps: AppDeps, v: SessionUser, id: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  const b = await sharedOne(deps.db, id, false);
  if (!b) throw notFound();
  if (b.user_id === v.userId) throw new ApiError(409, 'own_bookmark', 'That bookmark is yours.');
  const rid = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, 'bookmark', $2, $3, $4, $5, $6, $7)`,
        [rid, b.id, b.board_id ? 'board' : 'site', b.board_id ?? 'site', v.userId, category, note]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.created', targetType: 'bookmark', targetId: b.id, after: { category }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'reports_one_open') throw new ApiError(409, 'already_reported', 'You already reported this. The moderators have it.');
    throw err;
  }
  return { id: rid };
}

// Admins, and a ring's ops for its bookmarks, take one down (or put it back) with a reason. Always audited.
export async function hideBookmark(deps: AppDeps, v: SessionUser, id: string, hide: boolean, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const b = await sharedOne(q, id, true);
    if (!b) throw notFound();
    if (!canHide(v, b.ring_id)) throw new ApiError(403, 'forbidden', 'Only admins, and a ring’s ops for its links, can do that.');
    const r = await q.query(`UPDATE bookmarks SET hidden_at = ${hide ? 'now()' : 'NULL'}, hidden_reason = $2 WHERE id = $1 AND (hidden_at IS NULL) = $3`, [id, hide ? reason : null, hide]);
    if (!r.rowCount) throw new ApiError(409, 'no_change', hide ? 'That bookmark is already hidden.' : 'That bookmark is not hidden.');
    if (hide) await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = 'bookmark hidden' WHERE target_type = 'bookmark' AND target_id = $1 AND status = 'open'`, [id, v.userId]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: hide ? 'bookmark.hidden' : 'bookmark.restored', targetType: 'bookmark', targetId: id,
      after: { reason, owner_id: b.user_id, ring_id: b.ring_id, url: b.url }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// ---------------------------------------------------------------- export and import (docs/12)

export interface ExportedBookmark { url: string; title: string; description: string; tags: string[]; pinned: boolean; visibility: BookmarkVisibility; ring: string | null; created_at: string }

export async function exportBookmarks(q: Queryable, userId: string): Promise<ExportedBookmark[]> {
  const r = await q.query<{ url: string; title: string; description: string; tags: string[]; pinned: boolean; visibility: BookmarkVisibility; ring: string | null; created_at: Date }>(
    `SELECT b.url, b.title, b.description, b.tags, b.pinned, b.visibility, g.slug AS ring, b.created_at ${FROM} WHERE b.user_id = $1 ORDER BY b.created_at`, [userId]);
  return r.rows.map((x) => ({ ...x, created_at: x.created_at.toISOString() }));
}

// Brings bookmarks back without fetching anything: the export already has their titles. Everything comes back
// private (sharing again is the person's choice); ones they already have are left alone.
export async function importBookmarks(deps: AppDeps, v: SessionUser, items: unknown[]): Promise<{ restored: number; codes: string[] }> {
  const codes: string[] = [];
  let restored = 0;
  for (const raw of items.slice(0, BOOKMARKS_MAX)) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const parsed = bookmarkCreateSchema.safeParse({ url: x.url, title: typeof x.title === 'string' && x.title.trim() ? x.title.slice(0, BOOKMARK_TITLE_MAX) : undefined,
      description: typeof x.description === 'string' ? x.description.slice(0, BOOKMARK_DESCRIPTION_MAX) : '', tags: Array.isArray(x.tags) ? x.tags : [], pinned: x.pinned === true });
    if (!parsed.success) { codes.push('invalid'); continue; }
    try {
      const r = await addBookmark(deps, v, parsed.data, { fetch: false });
      if (r.existing) { codes.push('exists'); continue; }
      restored += 1;
      if (x.visibility && x.visibility !== 'private') codes.push('made_private');
      if (typeof x.created_at === 'string' && !Number.isNaN(Date.parse(x.created_at))) {
        await deps.db.query(`UPDATE bookmarks SET created_at = $2 WHERE id = $1`, [r.bookmark.id, x.created_at]);
      }
    } catch (e) {
      codes.push(e instanceof ApiError ? e.code : 'failed');
      if (e instanceof ApiError && e.code === 'too_many') break;
    }
  }
  return { restored, codes };
}
