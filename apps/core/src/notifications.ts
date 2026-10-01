import type { NotificationKind, NotificationView } from '@app/shared';
import { newId } from './crypto';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { extractMentions } from './text';
import type { SessionUser } from './accounts';

// Called inside the transaction that stores a post. `rootAuthorId` is not needed: the parent post's
// author is who a reply is for. One person gets one notification per post, the most direct kind
// first: a reply, then a mention, then the board being watched. Nobody is told about their own
// post, and nobody is told about a board they cannot read.
export async function notifyForPost(q: Queryable, post: {
  id: string; boardId: string; visibility: string; authorId: string; body: string; isThread: boolean; replyToAuthorId: string | null;
}): Promise<string[]> {
  const chosen = new Map<string, NotificationKind>();
  if (post.replyToAuthorId) chosen.set(post.replyToAuthorId, 'reply');

  const handles = extractMentions(post.body);
  const mentioned = handles.length
    ? (await q.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = ANY($1) AND status = 'active' AND role <> 'guest'`, [handles])).rows
    : [];
  for (const u of mentioned) if (!chosen.has(u.id)) chosen.set(u.id, 'mention');

  // Watching a board means hearing about new threads on it. Replies inside threads reach you as
  // replies or mentions, so a busy thread does not bury you.
  if (post.isThread) {
    const watchers = await q.query<{ user_id: string }>(`SELECT user_id FROM watches WHERE board_id = $1`, [post.boardId]);
    for (const w of watchers.rows) if (!chosen.has(w.user_id)) chosen.set(w.user_id, 'watch');
  }
  chosen.delete(post.authorId);
  if (chosen.size === 0) return [];

  // Keep only people who can read this board and are in good standing.
  const ids = [...chosen.keys()];
  const ok = await q.query<{ id: string }>(
    `SELECT u.id FROM users u WHERE u.id = ANY($1) AND u.status = 'active' AND u.role <> 'guest'
       AND ($2 IN ('public', 'members', 'ring') OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = $3 AND m.user_id = u.id))`,
    [ids, post.visibility, post.boardId]);
  for (const { id } of ok.rows) {
    await q.query(
      `INSERT INTO notifications (id, user_id, kind, post_id, board_id, actor_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, post_id) DO NOTHING`,
      [newId('n'), id, chosen.get(id), post.id, post.boardId, post.authorId]);
  }
  return ok.rows.map((r) => r.id);
}

interface Row {
  id: string; kind: NotificationKind; created_at: Date; read_at: Date | null; slug: string; board_name: string;
  post_id: string; thread_id: string; subject: string; actor_id: string; handle: string; display_name: string | null; seq: string;
}

// Notifications about posts that were deleted, hidden, or are on a board you can no longer read are not shown.
const VISIBLE = `p.deleted_at IS NULL AND p.hidden_at IS NULL AND b.hidden_at IS NULL
  AND (b.visibility IN ('public', 'members', 'ring') OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = n.user_id))`;

export async function listNotifications(deps: AppDeps, v: SessionUser, opts: { before?: string; limit?: number }): Promise<{ notifications: NotificationView[]; unread: number; next: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const r = await deps.db.query<Row>(
    `SELECT n.id, n.kind, n.created_at, n.read_at, b.slug, b.name AS board_name, p.id AS post_id,
            COALESCE(p.thread_root_id, p.id) AS thread_id,
            COALESCE(NULLIF(p.subject, ''), '') AS subject, u.id AS actor_id, u.handle, u.display_name, p.seq
     FROM notifications n JOIN posts p ON p.id = n.post_id JOIN boards b ON b.id = n.board_id JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = $1 AND ${VISIBLE}
       AND ($2::text IS NULL OR (n.created_at, n.id) < (SELECT created_at, id FROM notifications WHERE id = $2 AND user_id = $1))
     ORDER BY n.created_at DESC, n.id DESC LIMIT $3`,
    [v.userId, opts.before ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  return {
    notifications: page.map((x) => ({
      id: x.id, kind: x.kind, at: x.created_at.toISOString(), read: x.read_at !== null, board: { slug: x.slug, name: x.board_name },
      thread_id: x.thread_id, post_id: x.post_id, subject: x.subject, actor: { id: x.actor_id, handle: x.handle, display_name: x.display_name },
    })),
    unread: await unreadCount(deps, v),
    next: r.rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

export async function unreadCount(deps: AppDeps, v: SessionUser): Promise<number> {
  const r = await deps.db.query<{ n: string }>(
    `SELECT count(*) AS n FROM notifications n JOIN posts p ON p.id = n.post_id JOIN boards b ON b.id = n.board_id
     WHERE n.user_id = $1 AND n.read_at IS NULL AND ${VISIBLE}`, [v.userId]);
  return Number(r.rows[0]!.n);
}

export async function markRead(deps: AppDeps, v: SessionUser, target: { ids: string[] } | { all: true }): Promise<void> {
  if ('all' in target) {
    await deps.db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [v.userId]);
    return;
  }
  const r = await deps.db.query(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND id = ANY($2)`, [v.userId, target.ids]);
  if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'No such notification.');
}
