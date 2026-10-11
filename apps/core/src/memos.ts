import { MEMOS_PER_PERSON, extractTags, type MemoPage, type MemoView, type MemoVisibility } from '@app/shared';
import type { z } from 'zod';
import type { memoCreateSchema, memoListQuerySchema, memoUpdateSchema } from '@app/shared';
import type { SessionUser } from './accounts';
import { isMember } from './boards';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import type { Queryable } from './db';
import { ApiError } from './errors';
import { normalizeBody } from './text';
import { MEMO_MAX } from '@app/shared';

// Memos (docs/22): a person's short notes. In this first step every memo is private to its writer, and every query here is
// scoped to the signed-in person, so nothing else exists to leak.

interface Row {
  id: string; body: string; tags: string[]; pinned: boolean; visibility: MemoVisibility; ring_slug: string | null; ring_name: string | null;
  created_at: Date; edited_at: Date | null;
}
const COLUMNS = `m.id, m.body, m.pinned, m.visibility, g.slug AS ring_slug, g.name AS ring_name, m.created_at, m.edited_at,
  COALESCE((SELECT array_agg(t.tag ORDER BY t.tag) FROM memo_tags t WHERE t.memo_id = m.id), '{}') AS tags`;
const FROM = `FROM memos m LEFT JOIN rings g ON g.id = m.ring_id`;
const toView = (r: Row): MemoView => ({
  id: r.id, body: r.body, tags: r.tags, pinned: r.pinned, visibility: r.visibility, ring: r.ring_slug ? { slug: r.ring_slug, name: r.ring_name! } : null,
  created_at: r.created_at.toISOString(), edited_at: r.edited_at?.toISOString() ?? null,
});
const notFound = () => new ApiError(404, 'not_found', 'There is no such memo.');
function mustBeMember(v: SessionUser): void {
  if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
}

async function setTags(q: Queryable, id: string, body: string): Promise<void> {
  await q.query(`DELETE FROM memo_tags WHERE memo_id = $1`, [id]);
  for (const tag of extractTags(body)) await q.query(`INSERT INTO memo_tags (memo_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, tag]);
}

export async function getMemo(deps: AppDeps, v: SessionUser, id: string, q: Queryable = deps.db): Promise<MemoView> {
  const r = await q.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.id = $1 AND m.user_id = $2`, [id, v.userId]);
  if (!r.rows[0]) throw notFound();
  return toView(r.rows[0]);
}

export async function addMemo(deps: AppDeps, v: SessionUser, input: z.infer<typeof memoCreateSchema>): Promise<MemoView> {
  mustBeMember(v);
  const body = normalizeBody(input.body, { max: MEMO_MAX, what: 'A memo' });
  const n = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM memos WHERE user_id = $1`, [v.userId])).rows[0]!.n);
  if (n >= MEMOS_PER_PERSON) throw new ApiError(409, 'too_many', `You can keep up to ${MEMOS_PER_PERSON.toLocaleString('en')} memos. Delete some to write more.`);
  const id = newId('mm');
  await deps.db.tx(async (q) => {
    await q.query(`INSERT INTO memos (id, user_id, body, pinned, visibility) VALUES ($1, $2, $3, $4, 'private')`, [id, v.userId, body, input.pinned]);
    await setTags(q, id, body);
  });
  return getMemo(deps, v, id);
}

export async function updateMemo(deps: AppDeps, v: SessionUser, id: string, input: z.infer<typeof memoUpdateSchema>): Promise<MemoView> {
  await deps.db.tx(async (q) => {
    const cur = await q.query<{ body: string }>(`SELECT body FROM memos WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, v.userId]);
    if (!cur.rows[0]) throw notFound();
    if (input.body !== undefined) {
      const body = normalizeBody(input.body, { max: MEMO_MAX, what: 'A memo' });
      if (body !== cur.rows[0].body) {
        await q.query(`UPDATE memos SET body = $2, edited_at = now() WHERE id = $1`, [id, body]);
        await setTags(q, id, body);
      }
    }
    if (input.pinned !== undefined) await q.query(`UPDATE memos SET pinned = $2 WHERE id = $1`, [id, input.pinned]);
  });
  return getMemo(deps, v, id);
}

export async function deleteMemo(deps: AppDeps, v: SessionUser, id: string): Promise<void> {
  const r = await deps.db.query(`DELETE FROM memos WHERE id = $1 AND user_id = $2`, [id, v.userId]);
  if (!r.rowCount) throw notFound();
}

// Pinned memos come first on the first page; the rest are newest first, paged by a cursor of time and id.
export async function listMemos(deps: AppDeps, v: SessionUser, query: z.infer<typeof memoListQuerySchema>): Promise<MemoPage> {
  const where = ['m.user_id = $1', 'm.reply_to IS NULL'];
  const params: unknown[] = [v.userId];
  const add = (sql: string, val: unknown) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };
  if (query.tag) add('EXISTS (SELECT 1 FROM memo_tags t WHERE t.memo_id = m.id AND t.tag = ?)', query.tag);
  if (query.q) add(`m.body_tsv @@ websearch_to_tsquery('simple', ?)`, query.q);
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM memos m WHERE ${where.join(' AND ')}`, params)).rows[0]!.n);
  const firstPage = !query.before;
  let pinned: Row[] = [];
  if (firstPage && query.pinned !== false) {
    pinned = (await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE ${where.join(' AND ')} AND m.pinned ORDER BY m.created_at DESC, m.id DESC LIMIT 50`, params)).rows;
  }
  if (query.pinned === true) return { memos: pinned.map(toView), next: null, total };
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
  return { memos: [...pinned, ...rows].map(toView), next: r.rows.length > query.limit && last ? `${last.created_at.toISOString()}|${last.id}` : null, total };
}

// The home panel's box: the newest few.
export async function hub(deps: AppDeps, v: SessionUser): Promise<{ recent: MemoView[]; total: number }> {
  const r = await deps.db.query<Row>(`SELECT ${COLUMNS} ${FROM} WHERE m.user_id = $1 AND m.reply_to IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 5`, [v.userId]);
  const total = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM memos WHERE user_id = $1 AND reply_to IS NULL`, [v.userId])).rows[0]!.n);
  return { recent: r.rows.map(toView), total };
}

export async function tagCounts(deps: AppDeps, v: SessionUser): Promise<{ tag: string; count: number }[]> {
  const r = await deps.db.query<{ tag: string; n: string }>(
    `SELECT t.tag, count(*) AS n FROM memo_tags t JOIN memos m ON m.id = t.memo_id WHERE m.user_id = $1 GROUP BY t.tag ORDER BY count(*) DESC, t.tag LIMIT 200`, [v.userId]);
  return r.rows.map((x) => ({ tag: x.tag, count: Number(x.n) }));
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
