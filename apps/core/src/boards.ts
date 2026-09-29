import type { BoardSummary, BoardVisibility, PostView, ThreadSummary } from '@app/shared';
import { audit } from './audit';
import { newId } from './crypto';
import { isUniqueViolation, type Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { emit } from './events';
import { notifyForPost } from './notifications';
import { normalizeBody, normalizeSubject, replySubject } from './text';
import type { Ctx, SessionUser } from './accounts';

// Who is looking. Null means logged out, and also a limited session (an admin who has not set up
// two-factor yet), which gets no more than a visitor would.
export type Viewer = SessionUser | null;
export const viewerOf = (s: SessionUser | null): Viewer => (s && !s.limited ? s : null);

const notFound = () => new ApiError(404, 'not_found', 'No such board.');
const isMember = (v: Viewer) => Boolean(v && v.role !== 'guest'); // a guest has not confirmed their email

// SQL that says which boards a viewer may read. `n` is the first of three parameters it uses.
// Private boards are for listed members only, admins included (docs/05).
function readable(v: Viewer, n: number, alias = 'b'): { sql: string; params: unknown[] } {
  return {
    sql: `((${alias}.hidden_at IS NULL OR $${n + 1}::boolean) AND (
      ${alias}.visibility IN ('public', 'ring')
      OR ($${n + 2}::boolean AND ${alias}.visibility = 'members')
      OR (${alias}.visibility = 'private' AND EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = ${alias}.id AND m.user_id = $${n}))))`,
    params: [v?.userId ?? null, v?.role === 'admin', isMember(v)],
  };
}

const canModerate = (v: Viewer, b: { id: string; owner_id: string }) =>
  Boolean(v && (v.role === 'admin' || v.userId === b.owner_id || v.ops.includes(`board:${b.id}`)));

interface BoardRow {
  id: string; slug: string; name: string; description: string; visibility: BoardVisibility; owner_id: string; owner_handle: string;
  category_id: string | null; category_name: string | null; archived_at: Date | null; hidden_at: Date | null;
  thread_count: string; post_count: string; last_post_at: Date | null; unread: string | null; watching: boolean; member: boolean;
}

const SUMMARY_SQL = `
  SELECT b.id, b.slug, b.name, b.description, b.visibility, b.owner_id, u.handle AS owner_handle,
    b.category_id, c.name AS category_name, b.archived_at, b.hidden_at,
    (SELECT count(*) FROM posts p WHERE p.board_id = b.id AND p.thread_root_id IS NULL AND p.deleted_at IS NULL AND p.hidden_at IS NULL) AS thread_count,
    (SELECT count(*) FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL) AS post_count,
    (SELECT max(p.posted_at) FROM posts p WHERE p.board_id = b.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL) AS last_post_at,
    CASE WHEN $1::text IS NULL THEN NULL ELSE (SELECT count(*) FROM posts p
      WHERE p.board_id = b.id AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND p.author_id IS DISTINCT FROM $1
        AND p.seq > COALESCE((SELECT r.last_read_seq FROM read_state r WHERE r.user_id = $1 AND r.board_id = b.id), 0)) END AS unread,
    EXISTS (SELECT 1 FROM watches w WHERE w.user_id = $1 AND w.board_id = b.id) AS watching,
    EXISTS (SELECT 1 FROM board_members m WHERE m.user_id = $1 AND m.board_id = b.id) AS member
  FROM boards b JOIN users u ON u.id = b.owner_id LEFT JOIN board_categories c ON c.id = b.category_id`;

function canPost(v: Viewer, r: BoardRow): boolean {
  if (!v || !isMember(v) || r.archived_at) return false;
  if (r.visibility === 'public' || r.visibility === 'members') return true;
  if (r.visibility === 'private') return r.member;
  return false; // ring boards take ring members only, and rings arrive in M3
}

function toSummary(v: Viewer, r: BoardRow): BoardSummary {
  return {
    id: r.id, slug: r.slug, name: r.name, description: r.description, visibility: r.visibility,
    category: r.category_id ? { id: r.category_id, name: r.category_name! } : null,
    owner: { id: r.owner_id, handle: r.owner_handle },
    archived: r.archived_at !== null, hidden: r.hidden_at !== null,
    thread_count: Number(r.thread_count), post_count: Number(r.post_count), last_post_at: r.last_post_at ? r.last_post_at.toISOString() : null,
    unread: r.unread === null ? null : Number(r.unread), watching: r.watching, can_post: canPost(v, r), can_moderate: canModerate(v, r),
  };
}

// One board the viewer may read, or a 404 that does not say whether it exists.
async function loadBoard(q: Queryable, slug: string, v: Viewer): Promise<BoardRow> {
  const acc = readable(v, 2);
  const r = await q.query<BoardRow>(`${SUMMARY_SQL} WHERE b.slug = $${acc.params.length + 2} AND ${acc.sql}`, [v?.userId ?? null, ...acc.params, slug]);
  const row = r.rows[0];
  if (!row) throw notFound();
  return row;
}

// ---------------------------------------------------------------- boards

export async function listBoards(deps: AppDeps, v: Viewer): Promise<{ categories: { id: string; name: string }[]; boards: BoardSummary[] }> {
  const acc = readable(v, 2);
  const [boards, cats] = await Promise.all([
    deps.db.query<BoardRow>(`${SUMMARY_SQL} WHERE ${acc.sql} AND b.ring_id IS NULL ORDER BY c.sort NULLS LAST, c.name NULLS LAST, b.name`, [v?.userId ?? null, ...acc.params]),
    deps.db.query<{ id: string; name: string }>(`SELECT id, name FROM board_categories ORDER BY sort, name`),
  ]);
  return { categories: cats.rows, boards: boards.rows.map((r) => toSummary(v, r)) };
}

export async function getBoard(deps: AppDeps, v: Viewer, slug: string): Promise<BoardSummary> {
  return toSummary(v, await loadBoard(deps.db, slug, v));
}

export async function createBoard(
  deps: AppDeps, v: SessionUser, input: { slug: string; name: string; description: string; visibility: 'public' | 'members' | 'private' }, ctx: Ctx,
): Promise<BoardSummary> {
  if (v.role !== 'trusted' && v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only trusted users can create boards.');
  const id = newId('b');
  try {
    await deps.db.tx(async (q) => {
      // Lock the user's row so two requests made at once cannot both pass the quota check.
      await q.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [v.userId]);
      if (v.role !== 'admin') {
        const owned = await q.query<{ n: string }>(`SELECT count(*) AS n FROM boards WHERE owner_id = $1 AND archived_at IS NULL`, [v.userId]);
        const quota = deps.config.limits.trusted_board_quota;
        if (Number(owned.rows[0]!.n) >= quota) {
          throw new ApiError(409, 'quota_reached', `You can own ${quota} boards. Archive one or ask an admin.`);
        }
      }
      await q.query(`INSERT INTO boards (id, slug, name, description, owner_id, visibility) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, input.slug, input.name, input.description, v.userId, input.visibility]);
      if (input.visibility === 'private') await q.query(`INSERT INTO board_members (board_id, user_id, added_by) VALUES ($1, $2, $2)`, [id, v.userId]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'board.created', targetType: 'board', targetId: id,
        after: { slug: input.slug, name: input.name, visibility: input.visibility }, origin: 'web', ipHash: ctx.ipHash });
      await emit(q, 'board.created', { board_id: id, slug: input.slug, owner_id: v.userId, visibility: input.visibility });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'boards_slug_key')) throw new ApiError(409, 'slug_taken', 'That address is taken. Try another.');
    throw err;
  }
  return getBoard(deps, v, input.slug);
}

export async function updateBoard(
  deps: AppDeps, v: SessionUser, slug: string,
  patch: { name?: string; description?: string; visibility?: 'public' | 'members' | 'private'; archived?: boolean; category_id?: string | null }, ctx: Ctx,
): Promise<BoardSummary> {
  await deps.db.tx(async (q) => {
    const b = await loadBoard(q, slug, v);
    if (!canModerate(v, b)) throw new ApiError(403, 'forbidden', 'Only the board owner, its ops and admins can change it.');
    if (b.visibility === 'ring') throw new ApiError(409, 'ring_board', 'A ring board is managed through its ring.');
    if (patch.category_id !== undefined && v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can file a board under a category.');
    if (patch.category_id) {
      const c = await q.query(`SELECT 1 FROM board_categories WHERE id = $1`, [patch.category_id]);
      if (c.rowCount === 0) throw new ApiError(404, 'not_found', 'No such category.');
    }
    await q.query(`SELECT 1 FROM boards WHERE id = $1 FOR UPDATE`, [b.id]);
    const before = { name: b.name, description: b.description, visibility: b.visibility, archived: b.archived_at !== null, category_id: b.category_id };
    const after = {
      name: patch.name ?? before.name, description: patch.description ?? before.description, visibility: patch.visibility ?? before.visibility,
      archived: patch.archived ?? before.archived, category_id: patch.category_id !== undefined ? patch.category_id : before.category_id,
    };
    await q.query(
      `UPDATE boards SET name = $2, description = $3, visibility = $4, category_id = $5,
         archived_at = CASE WHEN $6::boolean THEN COALESCE(archived_at, now()) ELSE NULL END WHERE id = $1`,
      [b.id, after.name, after.description, after.visibility, after.category_id, after.archived]);
    // Going private must not lock the owner out of their own board.
    if (after.visibility === 'private') {
      await q.query(`INSERT INTO board_members (board_id, user_id, added_by) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING`, [b.id, b.owner_id]);
    }
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'board.updated', targetType: 'board', targetId: b.id, before, after, origin: 'web', ipHash: ctx.ipHash });
  });
  return getBoard(deps, v, slug);
}

export async function createCategory(deps: AppDeps, v: SessionUser, name: string, ctx: Ctx): Promise<{ id: string; name: string }> {
  if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can do that.');
  const id = newId('bc');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`INSERT INTO board_categories (id, name, sort) VALUES ($1, $2, (SELECT COALESCE(max(sort), 0) + 1 FROM board_categories))`, [id, name]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'board.category_created', targetType: 'board_category', targetId: id, after: { name }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'name_taken', 'There is already a category with that name.');
    throw err;
  }
  return { id, name };
}

// ---------------------------------------------------------------- members (private boards)

export async function listMembers(deps: AppDeps, v: SessionUser, slug: string): Promise<{ id: string; handle: string }[]> {
  const b = await loadBoard(deps.db, slug, v);
  if (!canModerate(v, b)) throw new ApiError(403, 'forbidden', 'Only the board owner, its ops and admins can see the member list.');
  const r = await deps.db.query<{ id: string; handle: string }>(
    `SELECT u.id, u.handle FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = $1 ORDER BY u.handle`, [b.id]);
  return r.rows;
}

export async function addMember(deps: AppDeps, v: SessionUser, slug: string, handle: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const b = await loadBoard(q, slug, v);
    if (!canModerate(v, b)) throw new ApiError(403, 'forbidden', 'Only the board owner, its ops and admins can add members.');
    if (b.visibility !== 'private') throw new ApiError(409, 'not_private', 'Only private boards have a member list.');
    const u = await q.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1) AND status = 'active' AND role <> 'guest'`, [handle]);
    const target = u.rows[0];
    if (!target) throw new ApiError(404, 'not_found', 'No user has that handle.');
    const ins = await q.query(`INSERT INTO board_members (board_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [b.id, target.id, v.userId]);
    if (ins.rowCount === 0) throw new ApiError(409, 'no_change', 'They are already a member.');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'board.member_added', targetType: 'board', targetId: b.id, after: { user_id: target.id }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function removeMember(deps: AppDeps, v: SessionUser, slug: string, userId: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const b = await loadBoard(q, slug, v);
    // Anyone can leave a board they were added to; removing someone else is for those in charge.
    if (userId !== v.userId && !canModerate(v, b)) throw new ApiError(403, 'forbidden', 'Only the board owner, its ops and admins can remove members.');
    if (userId === b.owner_id) throw new ApiError(409, 'owner', 'The owner stays a member. Transfer or archive the board instead.');
    const del = await q.query(`DELETE FROM board_members WHERE board_id = $1 AND user_id = $2`, [b.id, userId]);
    if (del.rowCount === 0) throw new ApiError(404, 'not_found', 'They are not a member.');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'board.member_removed', targetType: 'board', targetId: b.id, before: { user_id: userId }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// ---------------------------------------------------------------- watching and read pointers

export async function setWatching(deps: AppDeps, v: SessionUser, slug: string, on: boolean): Promise<void> {
  const b = await loadBoard(deps.db, slug, v);
  if (!isMember(v)) throw new ApiError(403, 'forbidden', 'Confirm your email address to watch boards.');
  if (on) await deps.db.query(`INSERT INTO watches (user_id, board_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [v.userId, b.id]);
  else await deps.db.query(`DELETE FROM watches WHERE user_id = $1 AND board_id = $2`, [v.userId, b.id]);
}

// The pointer only moves forward, so reading an old thread never marks newer posts as unread.
export async function setReadPointer(deps: AppDeps, v: SessionUser, slug: string, target: { post_id: string } | { all: true }): Promise<void> {
  const b = await loadBoard(deps.db, slug, v);
  let seq: string | null;
  if ('all' in target) {
    seq = (await deps.db.query<{ s: string | null }>(`SELECT max(seq) AS s FROM posts WHERE board_id = $1`, [b.id])).rows[0]!.s;
  } else {
    const p = await deps.db.query<{ seq: string }>(`SELECT seq FROM posts WHERE id = $1 AND board_id = $2`, [target.post_id, b.id]);
    if (!p.rows[0]) throw new ApiError(404, 'not_found', 'No such post on this board.');
    seq = p.rows[0].seq;
  }
  if (seq === null) return;
  await deps.db.query(
    `INSERT INTO read_state (user_id, board_id, last_read_seq) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, board_id) DO UPDATE SET last_read_seq = GREATEST(read_state.last_read_seq, EXCLUDED.last_read_seq), updated_at = now()`,
    [v.userId, b.id, seq]);
}

// ---------------------------------------------------------------- posts

interface PostRow {
  id: string; seq: string; board_id: string; thread_id: string; reply_to_id: string | null; subject: string; body: string;
  posted_at: Date; edited_at: Date | null; hidden_at: Date | null; deleted_at: Date | null;
  author_id: string | null; handle: string | null; display_name: string | null;
}
const POST_COLUMNS = `p.id, p.seq, p.board_id, COALESCE(p.thread_root_id, p.id) AS thread_id, p.reply_to_id, p.subject, p.body,
  p.posted_at, p.edited_at, p.hidden_at, p.deleted_at, u.id AS author_id, u.handle, u.display_name`;
const POST_FROM = `posts p LEFT JOIN users u ON u.id = p.author_id`;

// A deleted post shows no text. A hidden one shows none either, except to the people who moderate it.
function toPostView(r: PostRow, mod: boolean): PostView {
  const state = r.deleted_at ? 'deleted' : r.hidden_at ? 'hidden' : 'ok';
  const show = state === 'ok' || (state === 'hidden' && mod);
  return {
    id: r.id, seq: Number(r.seq), board_id: r.board_id, thread_id: r.thread_id, reply_to_id: r.reply_to_id,
    subject: show ? r.subject : '', body: show ? r.body : null, state,
    author: r.author_id && state !== 'deleted' ? { id: r.author_id, handle: r.handle!, display_name: r.display_name } : null,
    posted_at: r.posted_at.toISOString(), edited_at: r.edited_at ? r.edited_at.toISOString() : null,
  };
}

export async function listThreads(deps: AppDeps, v: Viewer, slug: string, opts: { before?: number; limit?: number }): Promise<{ threads: ThreadSummary[]; next: number | null }> {
  const b = await loadBoard(deps.db, slug, v);
  const mod = canModerate(v, b);
  const limit = Math.min(opts.limit ?? 30, 100);
  const r = await deps.db.query<PostRow & { reply_count: number; last_seq: string; last_at: Date; unread: boolean }>(
    `SELECT ${POST_COLUMNS}, p.reply_count, p.last_seq,
       (SELECT max(x.posted_at) FROM posts x WHERE x.id = p.id OR x.thread_root_id = p.id) AS last_at,
       CASE WHEN $2::text IS NULL THEN false ELSE EXISTS (SELECT 1 FROM posts x
         WHERE (x.id = p.id OR x.thread_root_id = p.id) AND x.deleted_at IS NULL AND x.hidden_at IS NULL AND x.author_id IS DISTINCT FROM $2
           AND x.seq > COALESCE((SELECT s.last_read_seq FROM read_state s WHERE s.user_id = $2 AND s.board_id = p.board_id), 0)) END AS unread
     FROM ${POST_FROM}
     WHERE p.board_id = $1 AND p.thread_root_id IS NULL AND ($3::bigint IS NULL OR p.last_seq < $3)
       AND (p.hidden_at IS NULL OR $4::boolean) -- hidden threads are listed for moderators only
     ORDER BY p.last_seq DESC LIMIT $5`,
    [b.id, v?.userId ?? null, opts.before ?? null, mod, limit + 1]);
  const page = r.rows.slice(0, limit);
  const threads = page.map((row): ThreadSummary => {
    const post = toPostView(row, mod);
    return { id: row.id, subject: post.subject, author: post.author, posted_at: post.posted_at, reply_count: row.reply_count,
      last_post_at: row.last_at.toISOString(), last_seq: Number(row.last_seq), unread: row.unread, state: post.state };
  });
  return { threads, next: r.rows.length > limit ? Number(page[page.length - 1]!.last_seq) : null };
}

export async function getThread(deps: AppDeps, v: Viewer, slug: string, threadId: string, opts: { after?: number; limit?: number }): Promise<{ board: BoardSummary; posts: PostView[]; next: number | null }> {
  const b = await loadBoard(deps.db, slug, v);
  const mod = canModerate(v, b);
  const root = await deps.db.query<{ hidden_at: Date | null }>(`SELECT hidden_at FROM posts WHERE id = $1 AND board_id = $2 AND thread_root_id IS NULL`, [threadId, b.id]);
  if (!root.rows[0] || (root.rows[0].hidden_at && !mod)) throw new ApiError(404, 'not_found', 'No such thread.');
  const limit = Math.min(opts.limit ?? 200, 500);
  const r = await deps.db.query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM ${POST_FROM}
     WHERE (p.id = $1 OR p.thread_root_id = $1) AND ($2::bigint IS NULL OR p.seq > $2) ORDER BY p.seq LIMIT $3`,
    [threadId, opts.after ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  return { board: toSummary(v, b), posts: page.map((row) => toPostView(row, mod)), next: r.rows.length > limit ? Number(page[page.length - 1]!.seq) : null };
}

export async function createPost(
  deps: AppDeps, v: SessionUser, slug: string, input: { subject?: string; body: string; reply_to?: string },
): Promise<PostView> {
  const body = normalizeBody(input.body);
  const id = newId('p');
  await deps.db.tx(async (q) => {
    const b = await loadBoard(q, slug, v);
    if (!isMember(v)) throw new ApiError(403, 'email_not_verified', 'Confirm your email address to post.');
    if (b.archived_at) throw new ApiError(409, 'archived', 'This board is archived. It is read-only.');
    if (!canPost(v, b)) throw new ApiError(403, 'forbidden', 'You cannot post on this board.');
    // The board row is locked in share mode, so archiving it cannot race with this post.
    await q.query(`SELECT 1 FROM boards WHERE id = $1 FOR SHARE`, [b.id]);

    let rootId: string | null = null;
    let replyTo: string | null = null;
    let replyToAuthor: string | null = null;
    let subject: string;
    if (input.reply_to) {
      const target = await q.query<{ id: string; thread_root_id: string | null; subject: string; hidden_at: Date | null; deleted_at: Date | null; author_id: string | null }>(
        `SELECT id, thread_root_id, subject, hidden_at, deleted_at, author_id FROM posts WHERE id = $1 AND board_id = $2`, [input.reply_to, b.id]);
      const t = target.rows[0];
      if (!t) throw new ApiError(404, 'not_found', 'The post you are replying to is not on this board.');
      if (t.deleted_at || t.hidden_at) throw new ApiError(409, 'gone', 'That post was removed. Reply to another one.');
      rootId = t.thread_root_id ?? t.id;
      replyTo = t.id;
      replyToAuthor = t.author_id;
      const rootSubject = t.thread_root_id ? (await q.query<{ subject: string }>(`SELECT subject FROM posts WHERE id = $1`, [rootId])).rows[0]!.subject : t.subject;
      subject = input.subject?.trim() ? normalizeSubject(input.subject) : replySubject(rootSubject);
    } else {
      subject = normalizeSubject(input.subject ?? '');
      if (!subject) throw new ApiError(400, 'empty_subject', 'Give the thread a subject.');
    }

    const ins = await q.query<{ seq: string }>(
      `INSERT INTO posts (id, board_id, author_id, thread_root_id, reply_to_id, subject, body) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING seq`,
      [id, b.id, v.userId, rootId, replyTo, subject, body]);
    const seq = ins.rows[0]!.seq;
    if (rootId) await q.query(`UPDATE posts SET reply_count = reply_count + 1, last_seq = $2 WHERE id = $1`, [rootId, seq]);
    else await q.query(`UPDATE posts SET last_seq = $2 WHERE id = $1`, [id, seq]);
    await emit(q, 'post.created', { post_id: id, board_id: b.id, thread_id: rootId ?? id, author_id: v.userId, visibility: b.visibility });
    await notifyForPost(q, { id, boardId: b.id, visibility: b.visibility, authorId: v.userId, body, isThread: rootId === null, replyToAuthorId: replyToAuthor });
  });
  const r = await deps.db.query<PostRow>(`SELECT ${POST_COLUMNS} FROM ${POST_FROM} WHERE p.id = $1`, [id]);
  return toPostView(r.rows[0]!, false);
}

// Authors can delete their own posts. The text is erased and a tombstone stays so replies keep their place.
export async function deletePost(deps: AppDeps, v: SessionUser, postId: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const p = await q.query<{ id: string; board_id: string; author_id: string | null; thread_root_id: string | null; deleted_at: Date | null; hidden_at: Date | null; slug: string }>(
      `SELECT p.id, p.board_id, p.author_id, p.thread_root_id, p.deleted_at, p.hidden_at, b.slug FROM posts p JOIN boards b ON b.id = p.board_id WHERE p.id = $1 FOR UPDATE OF p`, [postId]);
    const post = p.rows[0];
    if (!post) throw new ApiError(404, 'not_found', 'No such post.');
    await loadBoard(q, post.slug, v); // a post on a board you cannot read does not exist for you
    if (post.author_id !== v.userId) throw new ApiError(403, 'forbidden', 'You can only delete your own posts.');
    if (post.deleted_at) throw new ApiError(409, 'no_change', 'That post is already deleted.');
    await q.query(`UPDATE posts SET deleted_at = now(), subject = '', body = '' WHERE id = $1`, [postId]);
    if (post.thread_root_id && !post.hidden_at) await q.query(`UPDATE posts SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1`, [post.thread_root_id]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'post.deleted', targetType: 'post', targetId: postId, after: { by: 'author' }, origin: 'web', ipHash: ctx.ipHash });
    await emit(q, 'post.deleted', { post_id: postId, board_id: post.board_id });
  });
}

// ---------------------------------------------------------------- search

export interface SearchHit { post: PostView; board: { slug: string; name: string }; snippet: string }

// The snippet marks matches with \u0002 … \u0003. Post text can never contain those (see text.ts),
// so the reader can split on them safely and never needs to treat the snippet as HTML.
export async function search(deps: AppDeps, v: Viewer, q: string, opts: { board?: string; offset?: number; limit?: number }): Promise<{ hits: SearchHit[]; next: number | null }> {
  const acc = readable(v, 1);
  const limit = Math.min(opts.limit ?? 20, 50);
  const offset = opts.offset ?? 0;
  const n = acc.params.length + 1;
  const r = await deps.db.query<PostRow & { slug: string; board_name: string; owner_id: string; snippet: string; mod: boolean }>(
    `SELECT ${POST_COLUMNS}, b.slug, b.name AS board_name, b.owner_id,
       ts_headline('english', p.subject || E'\\n' || p.body, websearch_to_tsquery('english', $${n}),
         'StartSel=\u0002, StopSel=\u0003, MaxWords=30, MinWords=12, MaxFragments=1') AS snippet
     FROM posts p JOIN boards b ON b.id = p.board_id LEFT JOIN users u ON u.id = p.author_id
     WHERE p.body_tsv @@ websearch_to_tsquery('english', $${n}) AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND ${acc.sql}
       AND ($${n + 1}::text IS NULL OR b.slug = $${n + 1})
     ORDER BY ts_rank(p.body_tsv, websearch_to_tsquery('english', $${n})) DESC, p.seq DESC
     OFFSET $${n + 2} LIMIT $${n + 3}`,
    [...acc.params, q, opts.board ?? null, offset, limit + 1]);
  const page = r.rows.slice(0, limit);
  return {
    hits: page.map((row) => ({ post: toPostView(row, false), board: { slug: row.slug, name: row.board_name }, snippet: row.snippet })),
    next: r.rows.length > limit ? offset + limit : null,
  };
}
