import { MEMOS_PER_PERSON, REACTIONS, extractTags, type MemoPage, type MemoView, type MemoVisibility, type ProfileMemo, type ReactionName } from '@app/shared';
import { fuzzy, isFuzzy } from './search';
import type { z } from 'zod';
import type { memoCreateSchema, memoListQuerySchema, memoUpdateSchema } from '@app/shared';
import type { Ctx, SessionUser } from './accounts';
import { isMember, type Viewer } from './boards';
import { audit } from './audit';
import { notifyOther } from './notifications';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import type { Queryable } from './db';
import { ApiError } from './errors';
import { normalizeBody } from './text';
import { MEMO_MAX } from '@app/shared';

// Memos (docs/22): a person's short notes, private unless shared. A shared memo can be read by anyone (public) or by the
// members of one ring (ring), and answered with replies and reactions. A reply has no sharing of its own: it is readable
// while the memo it answers is. One rule (SHARED) gates every read of someone else's memo.

interface Row {
  id: string; body: string; tags: string[]; pinned: boolean; visibility: MemoVisibility; ring_slug: string | null; ring_name: string | null; ring_id: string | null;
  created_at: Date; edited_at: Date | null; user_id: string; handle: string; display_name: string | null; reply_to: string | null;
  hidden_at: Date | null; hidden_reason: string | null; reply_count: number;
}
const COLUMNS = `m.id, m.body, m.pinned, m.visibility, g.slug AS ring_slug, g.name AS ring_name, m.ring_id, m.created_at, m.edited_at,
  m.user_id, u.handle, u.display_name, m.reply_to, m.hidden_at, m.hidden_reason,
  COALESCE((SELECT array_agg(t.tag ORDER BY t.tag) FROM memo_tags t WHERE t.memo_id = m.id), '{}') AS tags,
  (SELECT count(*)::int FROM memos r WHERE r.reply_to = m.id AND r.hidden_at IS NULL) AS reply_count`;
const FROM = `FROM memos m JOIN users u ON u.id = m.user_id LEFT JOIN rings g ON g.id = m.ring_id`;

// What anyone may read (a root memo; `v` is the viewer's id parameter): shared, not taken down, by someone active, and for a
// ring memo a ring that is not hidden and the viewer in it.
const sharedWhere = (v: string) => `(m.visibility <> 'private' AND m.hidden_at IS NULL AND u.status = 'active' AND u.role <> 'guest'
  AND (m.visibility = 'public' OR (m.visibility = 'ring' AND g.hidden_at IS NULL AND EXISTS (SELECT 1 FROM ring_members rm WHERE rm.ring_id = m.ring_id AND rm.user_id = ${v} AND rm.status = 'member'))))`;

const notFound = () => new ApiError(404, 'not_found', 'There is no such memo.');
function mustBeMember(v: SessionUser): void {
  if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
}
const canHide = (v: Viewer, ringId: string | null) => Boolean(v && (v.role === 'admin' || (ringId && v.ops.includes(`ring:${ringId}`))));

async function setTags(q: Queryable, id: string, body: string): Promise<void> {
  await q.query(`DELETE FROM memo_tags WHERE memo_id = $1`, [id]);
  for (const tag of extractTags(body)) await q.query(`INSERT INTO memo_tags (memo_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, tag]);
}

// Reactions and the viewer's own, for a batch of memos.
async function decorate(q: Queryable, rows: Row[], viewer: Viewer, rootRing: Map<string, string | null>): Promise<MemoView[]> {
  const ids = rows.map((r) => r.id);
  const by = new Map<string, MemoView['reactions']>();
  if (ids.length) {
    const r = await q.query<{ memo_id: string; reaction: ReactionName; n: number; mine: boolean }>(
      `SELECT memo_id, reaction, count(*)::int AS n, bool_or(user_id = $2) AS mine FROM memo_reactions WHERE memo_id = ANY($1) GROUP BY memo_id, reaction`, [ids, viewer?.userId ?? null]);
    for (const x of r.rows) (by.get(x.memo_id) ?? by.set(x.memo_id, []).get(x.memo_id)!).push({ name: x.reaction, count: x.n, mine: x.mine });
  }
  return rows.map((r) => ({
    id: r.id, body: r.body, tags: r.tags, pinned: r.pinned, visibility: r.visibility, ring: r.ring_slug ? { slug: r.ring_slug, name: r.ring_name! } : null,
    created_at: r.created_at.toISOString(), edited_at: r.edited_at?.toISOString() ?? null,
    owner: { id: r.user_id, handle: r.handle, display_name: r.display_name }, reply_to: r.reply_to, reply_count: r.reply_count,
    reactions: (by.get(r.id) ?? []).sort((a, b) => REACTIONS.indexOf(a.name as ReactionName) - REACTIONS.indexOf(b.name as ReactionName)),
    hidden: r.hidden_at ? { reason: r.hidden_reason ?? '' } : null,
    can_hide: canHide(viewer, r.ring_id ?? rootRing.get(r.reply_to ?? r.id) ?? null),
    mine: viewer?.userId === r.user_id,
  }));
}
const view = async (q: Queryable, rows: Row[], viewer: Viewer) => decorate(q, rows, viewer, new Map());

export async function getMemo(deps: AppDeps, v: SessionUser, id: string, q: Queryable = deps.db): Promise<MemoView> {
  const r = await q.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.id = $1 AND m.user_id = $2`, [id, v.userId]);
  if (!r.rows[0]) throw notFound();
  return (await view(q, r.rows, v))[0]!;
}

// Sharing into a ring needs the writer to be in it, and the ring to be open for business.
async function ringFor(q: Queryable, v: SessionUser, slug: string): Promise<string> {
  const r = await q.query<{ id: string }>(
    `SELECT g.id FROM rings g JOIN ring_members m ON m.ring_id = g.id AND m.user_id = $2 AND m.status = 'member'
      WHERE g.slug = $1 AND g.archived_at IS NULL AND g.hidden_at IS NULL`, [slug, v.userId]);
  if (!r.rows[0]) throw new ApiError(403, 'not_in_ring', 'You can only share into a ring you are in.');
  return r.rows[0].id;
}

export async function shareableRings(deps: AppDeps, v: SessionUser): Promise<{ slug: string; name: string }[]> {
  const r = await deps.db.query<{ slug: string; name: string }>(
    `SELECT g.slug, g.name FROM rings g JOIN ring_members m ON m.ring_id = g.id AND m.user_id = $1 AND m.status = 'member'
      WHERE g.archived_at IS NULL AND g.hidden_at IS NULL ORDER BY lower(g.name)`, [v.userId]);
  return r.rows;
}

export async function addMemo(deps: AppDeps, v: SessionUser, input: z.infer<typeof memoCreateSchema>): Promise<MemoView> {
  mustBeMember(v);
  const body = normalizeBody(input.body, { max: MEMO_MAX, what: 'A memo' });
  const n = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM memos WHERE user_id = $1`, [v.userId])).rows[0]!.n);
  if (n >= MEMOS_PER_PERSON) throw new ApiError(409, 'too_many', `You can keep up to ${MEMOS_PER_PERSON.toLocaleString('en')} memos. Delete some to write more.`);
  const ringId = input.visibility === 'ring' ? await ringFor(deps.db, v, input.ring!) : null;
  const id = newId('mm');
  await deps.db.tx(async (q) => {
    await q.query(`INSERT INTO memos (id, user_id, body, pinned, visibility, ring_id) VALUES ($1, $2, $3, $4, $5, $6)`, [id, v.userId, body, input.pinned, input.visibility, ringId]);
    await setTags(q, id, body);
  });
  return getMemo(deps, v, id);
}

export async function updateMemo(deps: AppDeps, v: SessionUser, id: string, input: z.infer<typeof memoUpdateSchema>): Promise<MemoView> {
  await deps.db.tx(async (q) => {
    const cur = await q.query<{ body: string; reply_to: string | null; visibility: string; ring_slug: string | null }>(
      `SELECT m.body, m.reply_to, m.visibility, g.slug AS ring_slug FROM memos m LEFT JOIN rings g ON g.id = m.ring_id WHERE m.id = $1 AND m.user_id = $2 FOR UPDATE OF m`, [id, v.userId]);
    if (!cur.rows[0]) throw notFound();
    if (input.body !== undefined) {
      const body = normalizeBody(input.body, { max: MEMO_MAX, what: 'A memo' });
      if (body !== cur.rows[0].body) {
        await q.query(`UPDATE memos SET body = $2, edited_at = now() WHERE id = $1`, [id, body]);
        if (!cur.rows[0].reply_to) await setTags(q, id, body);
      }
    }
    if (input.pinned !== undefined) {
      if (cur.rows[0].reply_to) throw new ApiError(400, 'reply_pin', 'A reply cannot be pinned.');
      await q.query(`UPDATE memos SET pinned = $2 WHERE id = $1`, [id, input.pinned]);
    }
    // Naming a ring shares it there; any other choice drops the ring. A reply has no sharing of its own.
    const visibility = input.visibility ?? (input.ring ? 'ring' : undefined);
    // The same sharing sent back with an edit changes nothing, so an archived ring doesn't block fixing a typo.
    const same = visibility === cur.rows[0].visibility && (visibility !== 'ring' || (input.ring ?? cur.rows[0].ring_slug) === cur.rows[0].ring_slug);
    if (visibility !== undefined && !same) {
      if (cur.rows[0].reply_to) throw new ApiError(400, 'reply_share', 'A reply is shared with the memo it answers.');
      await q.query(`UPDATE memos SET visibility = $2, ring_id = $3 WHERE id = $1`, [id, visibility, visibility === 'ring' ? await ringFor(q, v, input.ring!) : null]);
    }
  });
  return getMemo(deps, v, id);
}

// The writer's own memo or reply; and a memo's writer can remove replies to it.
export async function deleteMemo(deps: AppDeps, v: SessionUser, id: string): Promise<void> {
  const r = await deps.db.query(
    `DELETE FROM memos m WHERE m.id = $1 AND (m.user_id = $2 OR EXISTS (SELECT 1 FROM memos root WHERE root.id = m.reply_to AND root.user_id = $2))`, [id, v.userId]);
  if (!r.rowCount) throw notFound();
}

// Pinned memos come first on the first page; the rest are newest first, paged by a cursor of time and id.
export async function listMemos(deps: AppDeps, v: SessionUser, query: z.infer<typeof memoListQuerySchema>): Promise<MemoPage> {
  const where = ['m.user_id = $1', 'm.reply_to IS NULL'];
  const params: unknown[] = [v.userId];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
  if (query.tag) add('EXISTS (SELECT 1 FROM memo_tags t WHERE t.memo_id = m.id AND t.tag = ?)', query.tag);
  if (query.q) {
    params.push(query.q);
    const p = `$${params.length}`;
    where.push(isFuzzy(query.q) ? `(m.body_tsv @@ websearch_to_tsquery('simple', ${p}) OR ${fuzzy('m.body', p)})` : `m.body_tsv @@ websearch_to_tsquery('simple', ${p})`);
  }
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM memos m WHERE ${where.join(' AND ')}`, params)).rows[0]!.n);
  const firstPage = !query.before;
  let pinned: Row[] = [];
  if (firstPage && query.pinned !== false) {
    pinned = (await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE ${where.join(' AND ')} AND m.pinned ORDER BY m.created_at DESC, m.id DESC LIMIT 50`, params)).rows;
  }
  if (query.pinned === true) return { memos: await view(deps.db, pinned, v), next: null, total };
  const rest = [...where, 'NOT m.pinned'];
  const p2 = [...params];
  if (query.before) {
    const [at, mid] = query.before.split('|');
    if (at && mid && !Number.isNaN(Date.parse(at))) { p2.push(at, mid); rest.push(`(m.created_at, m.id) < ($${p2.length - 1}::timestamptz, $${p2.length})`); }
  }
  p2.push(query.limit + 1);
  const r = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE ${rest.join(' AND ')} ORDER BY m.created_at DESC, m.id DESC LIMIT $${p2.length}`, p2);
  const rows = r.rows.slice(0, query.limit);
  const last = rows.at(-1);
  return { memos: await view(deps.db, [...pinned, ...rows], v), next: r.rows.length > query.limit && last ? `${last.created_at.toISOString()}|${last.id}` : null, total };
}

// The home panel's box: the newest few.
export async function hub(deps: AppDeps, v: SessionUser): Promise<{ recent: MemoView[]; total: number }> {
  const r = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.user_id = $1 AND m.reply_to IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 5`, [v.userId]);
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM memos WHERE user_id = $1 AND reply_to IS NULL`, [v.userId])).rows[0]!.n);
  return { recent: await view(deps.db, r.rows, v), total };
}

export async function tagCounts(deps: AppDeps, v: SessionUser): Promise<{ tag: string; count: number }[]> {
  const r = await deps.db.query<{ tag: string; n: string }>(
    `SELECT t.tag, count(*) AS n FROM memo_tags t JOIN memos m ON m.id = t.memo_id WHERE m.user_id = $1 GROUP BY t.tag ORDER BY count(*) DESC, t.tag LIMIT 200`, [v.userId]);
  return r.rows.map((x) => ({ tag: x.tag, count: Number(x.n) }));
}

// ---------------------------------------------------------------- shared memos (docs/22, M3)

async function sharedPage(deps: AppDeps, v: Viewer, where: string, params: unknown[], before: string | undefined, limit = 30): Promise<{ memos: MemoView[]; next: string | null }> {
  const all = [...params];
  let cursor = '';
  if (before) {
    const [at, mid] = before.split('|');
    if (at && mid && !Number.isNaN(Date.parse(at))) { all.push(at, mid); cursor = ` AND (m.created_at, m.id) < ($${all.length - 1}::timestamptz, $${all.length})`; }
  }
  all.push(limit + 1);
  const r = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.reply_to IS NULL AND ${where}${cursor} ORDER BY m.pinned DESC, m.created_at DESC, m.id DESC LIMIT $${all.length}`, all);
  const rows = r.rows.slice(0, limit);
  const last = rows.at(-1);
  return { memos: await view(deps.db, rows, v), next: r.rows.length > limit && last ? `${last.created_at.toISOString()}|${last.id}` : null };
}

// A person's public memos, for their profile.
export async function publicMemos(deps: AppDeps, v: Viewer, handle: string, before?: string, limit?: number): Promise<{ memos: MemoView[]; next: string | null }> {
  const u = (await deps.db.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1) AND status = 'active' AND role <> 'guest'`, [handle])).rows[0];
  if (!u) throw new ApiError(404, 'not_found', 'Nobody here goes by that name.');
  return sharedPage(deps, v, `m.user_id = $1 AND m.visibility = 'public' AND ${sharedWhere('$2')}`, [u.id, v?.userId ?? null], before, limit);
}

// What a ring's members shared into it, for the ring page. Only its members see these.
export async function ringMemos(deps: AppDeps, v: Viewer, slug: string, before?: string): Promise<{ memos: MemoView[]; next: string | null }> {
  const g = (await deps.db.query<{ id: string }>(`SELECT id FROM rings WHERE slug = $1`, [slug])).rows[0];
  if (!g) throw new ApiError(404, 'not_found', 'There is no ring by that name.');
  if (!v) return { memos: [], next: null };
  return sharedPage(deps, v, `m.ring_id = $1 AND m.visibility = 'ring' AND ${sharedWhere('$2')}`, [g.id, v.userId], before);
}

// The newest few public memos, for the line under someone's plan in finger, Gemini and the profile. Read as a logged-out visitor.
export async function newestPublic(q: Queryable, userId: string, limit = 3): Promise<ProfileMemo[]> {
  const r = await q.query<{ id: string; body: string; created_at: Date }>(
    `SELECT m.id, m.body, m.created_at FROM memos m JOIN users u ON u.id = m.user_id
      WHERE m.user_id = $1 AND m.visibility = 'public' AND m.reply_to IS NULL AND m.hidden_at IS NULL AND u.status = 'active' AND u.role <> 'guest'
      ORDER BY m.created_at DESC, m.id DESC LIMIT $2`, [userId, limit]);
  return r.rows.map((x) => ({ id: x.id, body: x.body, created_at: x.created_at.toISOString() }));
}

interface Access { memo: Row; root: Row; owner: boolean }
// A memo or reply the viewer may open: their own, or one in a thread whose first memo they may read.
async function access(q: Queryable, v: Viewer, id: string): Promise<Access> {
  const m = (await q.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.id = $1`, [id])).rows[0];
  if (!m) throw notFound();
  const root = m.reply_to ? (await q.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.id = $1`, [m.reply_to])).rows[0] : m;
  if (!root) throw notFound();
  if (v && (m.user_id === v.userId || root.user_id === v.userId)) return { memo: m, root, owner: root.user_id === v.userId };
  const ok = await q.query(`SELECT 1 FROM memos m JOIN users u ON u.id = m.user_id LEFT JOIN rings g ON g.id = m.ring_id WHERE m.id = $1 AND ${sharedWhere('$2')}`, [root.id, v?.userId ?? null]);
  if (!ok.rowCount || (m.hidden_at && !canHide(v, root.ring_id))) throw notFound();
  return { memo: m, root, owner: false };
}

// A memo with the replies under it.
export async function getThread(deps: AppDeps, v: Viewer, id: string): Promise<{ memo: MemoView; replies: MemoView[] }> {
  const a = await access(deps.db, v, id);
  const root = a.root;
  const replies = (await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.reply_to = $1 ORDER BY m.created_at, m.id`, [root.id])).rows
    .filter((r) => !r.hidden_at || (v && (r.user_id === v.userId || a.owner || canHide(v, root.ring_id))));
  const rings = new Map([[root.id, root.ring_id]]);
  const both = await decorate(deps.db, [root, ...replies], v, rings);
  return { memo: both[0]!, replies: both.slice(1) };
}

// A reply answers the memo at the top of a thread (an answer to a reply goes to the same thread).
export async function reply(deps: AppDeps, v: SessionUser, id: string, input: { body: string }): Promise<MemoView> {
  mustBeMember(v);
  const a = await access(deps.db, v, id);
  const root = a.root;
  if (root.visibility === 'private') throw new ApiError(409, 'private_memo', 'A private memo cannot be answered.');
  if (root.hidden_at && !a.owner) throw notFound();
  const body = normalizeBody(input.body, { max: MEMO_MAX, what: 'A reply' });
  const rid = newId('mm');
  let told: string[] = [];
  await deps.db.tx(async (q) => {
    await q.query(`INSERT INTO memos (id, user_id, body, visibility, reply_to) VALUES ($1, $2, $3, 'private', $4)`, [rid, v.userId, body, root.id]);
    told = await notifyOther(q, { userIds: [root.user_id], kind: 'memo_reply', actorId: v.userId, ref: root.id });
  });
  void told;
  const row = (await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.id = $1`, [rid])).rows[0]!;
  return (await decorate(deps.db, [row], v, new Map([[root.id, root.ring_id]])))[0]!;
}

// Leave a reaction on a memo or reply, or take it back. Returns the reactions as they now stand.
export async function react(deps: AppDeps, v: SessionUser, id: string, reaction: ReactionName, on: boolean): Promise<{ reactions: MemoView['reactions'] }> {
  mustBeMember(v);
  const a = await access(deps.db, v, id);
  if (a.root.visibility === 'private') throw new ApiError(409, 'private_memo', 'A private memo cannot take reactions.');
  if (a.memo.hidden_at) throw new ApiError(409, 'gone', 'That memo is not showing, so it cannot take a reaction.');
  await deps.db.tx(async (q) => {
    if (on) {
      const added = await q.query(`INSERT INTO memo_reactions (memo_id, user_id, reaction) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, v.userId, reaction]);
      if (added.rowCount) await notifyOther(q, { userIds: [a.memo.user_id], kind: 'memo_reaction', actorId: v.userId, ref: id });
    } else await q.query(`DELETE FROM memo_reactions WHERE memo_id = $1 AND user_id = $2 AND reaction = $3`, [id, v.userId, reaction]);
  });
  return { reactions: (await decorate(deps.db, [a.memo], v, new Map()))[0]!.reactions };
}

// Reports on a ring memo go to the ring's ops (through its board) and the admins; on a public one, to the admins.
export async function reportMemo(deps: AppDeps, v: SessionUser, id: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  const a = await access(deps.db, v, id);
  if (a.memo.user_id === v.userId) throw new ApiError(409, 'own_memo', 'That memo is yours.');
  if (a.root.visibility === 'private' || a.memo.hidden_at) throw notFound();
  const board = a.root.ring_id ? (await deps.db.query<{ board_id: string | null }>(`SELECT board_id FROM rings WHERE id = $1`, [a.root.ring_id])).rows[0]?.board_id ?? null : null;
  const rid = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, 'memo', $2, $3, $4, $5, $6, $7)`,
        [rid, id, board ? 'board' : 'site', board ?? 'site', v.userId, category, note]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.created', targetType: 'memo', targetId: id, after: { category }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'reports_one_open') throw new ApiError(409, 'already_reported', 'You already reported this. The moderators have it.');
    throw err;
  }
  return { id: rid };
}

// Admins, and a ring's ops for its memos, take one down (or put it back) with a reason. Always audited.
export async function hideMemo(deps: AppDeps, v: SessionUser, id: string, hide: boolean, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const m = (await q.query<{ id: string; reply_to: string | null; ring_id: string | null; visibility: MemoVisibility; user_id: string }>(
      `SELECT m.id, m.reply_to, COALESCE(r.ring_id, m.ring_id) AS ring_id, COALESCE(r.visibility, m.visibility) AS visibility, m.user_id FROM memos m LEFT JOIN memos r ON r.id = m.reply_to WHERE m.id = $1`, [id])).rows[0];
    if (!m || m.visibility === 'private') throw notFound();
    if (!canHide(v, m.ring_id)) throw new ApiError(403, 'forbidden', 'Only admins, and a ring’s ops for its memos, can do that.');
    const r = await q.query(`UPDATE memos SET hidden_at = ${hide ? 'now()' : 'NULL'}, hidden_reason = $2 WHERE id = $1 AND (hidden_at IS NULL) = $3`, [id, hide ? reason : null, hide]);
    if (!r.rowCount) throw new ApiError(409, 'no_change', hide ? 'That memo is already hidden.' : 'That memo is not hidden.');
    if (hide) await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = 'memo hidden' WHERE target_type = 'memo' AND target_id = $1 AND status = 'open'`, [id, v.userId]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: hide ? 'memo.hidden' : 'memo.restored', targetType: 'memo', targetId: id,
      after: { reason, owner_id: m.user_id, ring_id: m.ring_id }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// ---------------------------------------------------------------- export and import (docs/12)

export interface ExportedMemo { body: string; pinned: boolean; visibility: MemoVisibility; ring: string | null; reply_to: string | null; created_at: string; edited_at: string | null; tags: string[] }

export async function exportMemos(q: Queryable, userId: string): Promise<ExportedMemo[]> {
  const r = await q.query<{ id: string; body: string; pinned: boolean; visibility: MemoVisibility; ring: string | null; reply_to: string | null; created_at: Date; edited_at: Date | null; tags: string[] }>(
    `SELECT m.id, m.body, m.pinned, m.visibility, g.slug AS ring, m.reply_to, m.created_at, m.edited_at,
            COALESCE((SELECT array_agg(t.tag ORDER BY t.tag) FROM memo_tags t WHERE t.memo_id = m.id), '{}') AS tags
       FROM memos m LEFT JOIN rings g ON g.id = m.ring_id WHERE m.user_id = $1 ORDER BY m.created_at, m.id`, [userId]);
  return r.rows.map((x) => ({ body: x.body, pinned: x.pinned, visibility: x.visibility, ring: x.ring, reply_to: x.reply_to, created_at: x.created_at.toISOString(), edited_at: x.edited_at?.toISOString() ?? null, tags: x.tags }));
}

// Brings memos back as private top-level memos, keeping when they were written. Replies to other people's memos have nothing
// to attach to, so they are skipped. A memo with the same text and time is not made twice.
export async function importMemos(deps: AppDeps, v: SessionUser, items: unknown[]): Promise<{ restored: number; codes: string[] }> {
  const codes: string[] = [];
  let restored = 0;
  for (const raw of items.slice(0, MEMOS_PER_PERSON)) {
    const x = (raw ?? {}) as Record<string, unknown>;
    if (x.reply_to) { codes.push('memo_reply'); continue; }
    if (typeof x.body !== 'string') { codes.push('invalid'); continue; }
    let body: string;
    try { body = normalizeBody(x.body, { max: MEMO_MAX, what: 'A memo' }); } catch { codes.push('invalid'); continue; }
    const at = typeof x.created_at === 'string' && !Number.isNaN(Date.parse(x.created_at)) ? new Date(x.created_at) : new Date();
    const dup = await deps.db.query(`SELECT 1 FROM memos WHERE user_id = $1 AND body = $2 AND created_at = $3`, [v.userId, body, at]);
    if (dup.rowCount) { codes.push('exists'); continue; }
    try {
      const m = await addMemo(deps, v, { body, pinned: x.pinned === true, visibility: 'private' });
      await deps.db.query(`UPDATE memos SET created_at = $2, edited_at = $3 WHERE id = $1`, [m.id, at, typeof x.edited_at === 'string' && !Number.isNaN(Date.parse(x.edited_at)) ? new Date(x.edited_at) : null]);
      restored += 1;
      if (x.visibility && x.visibility !== 'private') codes.push('made_private');
    } catch (e) {
      codes.push(e instanceof ApiError ? e.code : 'failed');
      if (e instanceof ApiError && e.code === 'too_many') break;
    }
  }
  return { restored, codes };
}
