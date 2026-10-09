import { NOTIFICATION_PREF, type NotificationCounts, type NotificationKind, type NotificationView } from '@app/shared';
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
  id: string; boardId: string; visibility: string; authorId: string; body: string; isThread: boolean; replyToAuthorId: string | null; threadId?: string | null;
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
  // People following the thread hear about its replies (as replies, so their Settings choice for those applies).
  if (post.threadId) {
    const followers = await q.query<{ user_id: string }>(`SELECT user_id FROM thread_follows WHERE thread_id = $1`, [post.threadId]);
    for (const f of followers.rows) if (!chosen.has(f.user_id)) chosen.set(f.user_id, 'reply');
  }
  chosen.delete(post.authorId);
  if (chosen.size === 0) return [];

  // Keep only people who can read this board and are in good standing.
  const ids = [...chosen.keys()];
  const ok = await q.query<{ id: string }>(
    `SELECT u.id FROM users u WHERE u.id = ANY($1) AND u.status = 'active' AND u.role <> 'guest'
       AND ($2 IN ('public', 'members', 'ring') OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = $3 AND m.user_id = u.id))`,
    [ids, post.visibility, post.boardId]);
  // What people switched off: a kind they don't want on the site, or a board they muted (a mention still gets through).
  const off = await q.query<{ user_id: string; kind: string }>(
    `SELECT user_id, kind FROM notification_prefs WHERE user_id = ANY($1) AND NOT enabled
     UNION ALL SELECT user_id, 'board' FROM board_notification_prefs WHERE user_id = ANY($1) AND board_id = $2`, [ids, post.boardId]);
  const offKinds = new Map<string, Set<string>>();
  const muted = new Set<string>();
  for (const o of off.rows) {
    if (o.kind === 'board') muted.add(o.user_id);
    else offKinds.set(o.user_id, (offKinds.get(o.user_id) ?? new Set()).add(o.kind));
  }
  const mentionedIds = new Set(mentioned.map((u) => u.id));
  const skip = new Set<string>();
  for (const id of ids) {
    const switchedOff = offKinds.get(id);
    // Someone mentioned in a reply to them is both: they hear about it unless they switched off both.
    const kinds = [chosen.get(id)!, ...(mentionedIds.has(id) ? ['mention'] : [])];
    const wantsMention = mentionedIds.has(id) && !switchedOff?.has('mention');
    if (kinds.every((k) => switchedOff?.has(k)) || (muted.has(id) && !wantsMention)) skip.add(id);
  }
  ok.rows = ok.rows.filter((r) => !skip.has(r.id));
  for (const { id } of ok.rows) {
    await q.query(
      `INSERT INTO notifications (id, user_id, kind, post_id, board_id, actor_id) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, post_id) WHERE post_id IS NOT NULL AND kind IN ('reply', 'mention', 'watch') DO NOTHING`,
      [newId('n'), id, chosen.get(id), post.id, post.boardId, post.authorId]);
  }
  return ok.rows.map((r) => r.id);
}

// A notification about something other than a new post: new mail, a reaction, a ring event (docs/23, E2). `ref` is the
// thing it is about (a conversation, a ring, the reacted post). While one is unread, more of the same add to its count
// and move it to the top, so a busy conversation or a popular post is one line, not twenty.
// Respects what the person switched off. Nobody is told about their own doing.
export async function notifyOther(q: Queryable, n: {
  userIds: string[]; kind: NotificationKind; actorId: string; ref: string; postId?: string; boardId?: string;
}): Promise<string[]> {
  const ids = [...new Set(n.userIds)].filter((id) => id !== n.actorId);
  if (!ids.length) return [];
  const pref = NOTIFICATION_PREF[n.kind];
  const ok = await q.query<{ id: string }>(
    `SELECT u.id FROM users u WHERE u.id = ANY($1) AND u.status = 'active' AND u.role <> 'guest'
       AND NOT EXISTS (SELECT 1 FROM notification_prefs x WHERE x.user_id = u.id AND x.kind = $2 AND NOT x.enabled)`, [ids, pref]);
  let muted = new Set<string>();
  if (n.kind === 'reaction' && n.boardId) {
    muted = new Set((await q.query<{ user_id: string }>(`SELECT user_id FROM board_notification_prefs WHERE user_id = ANY($1) AND board_id = $2`, [ids, n.boardId])).rows.map((r) => r.user_id));
  }
  const told: string[] = [];
  for (const { id } of ok.rows) {
    if (muted.has(id)) continue;
    await q.query(
      `INSERT INTO notifications (id, user_id, kind, post_id, board_id, actor_id, ref) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, kind, ref) WHERE ref IS NOT NULL AND read_at IS NULL
       DO UPDATE SET count = notifications.count + 1, actor_id = EXCLUDED.actor_id, created_at = now()`,
      [newId('n'), id, n.kind, n.postId ?? null, n.boardId ?? null, n.actorId, n.ref]);
    told.push(id);
  }
  return told;
}

// Opening a conversation or a ring page answers what was waiting about it.
export async function clearFor(q: Queryable, userId: string, kind: NotificationKind, ref: string): Promise<void> {
  await q.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND kind = $2 AND ref = $3 AND read_at IS NULL`, [userId, kind, ref]);
}

interface Row {
  id: string; kind: NotificationKind; created_at: Date; read_at: Date | null; count: number; ref: string | null;
  slug: string | null; board_name: string | null; post_id: string | null; thread_id: string | null; subject: string | null;
  ring_slug: string | null; ring_name: string | null; mail_subject: string | null;
  actor_id: string; handle: string; display_name: string | null;
}

// What a notification is joined to, and when it still counts. Posts that were deleted or hidden, boards you can no
// longer read, conversations you left and rings that are gone are not shown.
const FROM = `FROM notifications n
  JOIN users u ON u.id = n.actor_id
  LEFT JOIN posts p ON p.id = n.post_id
  LEFT JOIN boards b ON b.id = n.board_id
  LEFT JOIN rings r ON r.id = n.ref AND n.kind IN ('ring_invite', 'ring_request', 'ring_joined')
  LEFT JOIN mail_threads mt ON mt.id = n.ref AND n.kind = 'mail'`;
const VISIBLE = `(n.post_id IS NULL OR (p.deleted_at IS NULL AND p.hidden_at IS NULL AND b.hidden_at IS NULL
    AND (b.visibility IN ('public', 'members', 'ring') OR EXISTS (SELECT 1 FROM board_members m WHERE m.board_id = b.id AND m.user_id = n.user_id))))
  AND (n.kind <> 'mail' OR EXISTS (SELECT 1 FROM mail_participants mp WHERE mp.thread_id = n.ref AND mp.user_id = n.user_id AND mp.left_at IS NULL))
  AND (n.kind NOT IN ('ring_invite', 'ring_request', 'ring_joined') OR r.id IS NOT NULL)`;

function linkOf(x: Row): NotificationView['link'] {
  if (x.kind === 'mail') return { app: 'mail', to: x.ref! };
  if (x.ring_slug) return { app: 'rings', to: x.ring_slug };
  return { app: 'boards', to: `${x.slug}/t/${x.thread_id}` };
}

export async function listNotifications(deps: AppDeps, v: SessionUser, opts: { before?: string; limit?: number }): Promise<{ notifications: NotificationView[]; unread: number; next: string | null }> {
  const limit = Math.min(opts.limit ?? 30, 100);
  const r = await deps.db.query<Row>(
    `SELECT n.id, n.kind, n.created_at, n.read_at, n.count, n.ref, b.slug, b.name AS board_name, p.id AS post_id,
            COALESCE(p.thread_root_id, p.id) AS thread_id,
            COALESCE(NULLIF(p.subject, ''), mt.subject, '') AS subject, r.slug AS ring_slug, r.name AS ring_name, mt.subject AS mail_subject,
            u.id AS actor_id, u.handle, u.display_name
     ${FROM}
     WHERE n.user_id = $1 AND ${VISIBLE}
       AND ($2::text IS NULL OR (n.created_at, n.id) < (SELECT created_at, id FROM notifications WHERE id = $2 AND user_id = $1))
     ORDER BY n.created_at DESC, n.id DESC LIMIT $3`,
    [v.userId, opts.before ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  return {
    notifications: page.map((x) => ({
      id: x.id, kind: x.kind, at: x.created_at.toISOString(), read: x.read_at !== null, count: x.count,
      subject: x.ring_name ?? x.subject ?? '', place: x.board_name ?? '', link: linkOf(x),
      actor: { id: x.actor_id, handle: x.handle, display_name: x.display_name },
    })),
    unread: await unreadCount(deps, v),
    next: r.rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

export async function unreadCount(deps: AppDeps, v: SessionUser): Promise<number> {
  return (await unreadCounts(deps, v)).unread;
}

// The bell's number, split by the app each kind belongs to. Mail and chat have their own counts. Admins also get the
// open reports, the same number the console shows.
export async function unreadCounts(deps: AppDeps, v: SessionUser): Promise<NotificationCounts> {
  const r = await deps.db.query<{ kind: NotificationKind; n: string }>(
    `SELECT n.kind, count(*) AS n ${FROM} WHERE n.user_id = $1 AND n.read_at IS NULL AND ${VISIBLE} GROUP BY n.kind`, [v.userId]);
  const by = (kinds: string[]) => r.rows.filter((x) => kinds.includes(x.kind)).reduce((a, x) => a + Number(x.n), 0);
  const out: NotificationCounts = {
    unread: by(r.rows.map((x) => x.kind)),
    by_app: { boards: by(['reply', 'mention', 'watch', 'reaction']), rings: by(['ring_invite', 'ring_request', 'ring_joined']) },
    mentions: by(['mention']),
  };
  if (v.role === 'admin') out.by_app.admin = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM reports WHERE status = 'open'`)).rows[0]!.n);
  return out;
}

export async function markRead(deps: AppDeps, v: SessionUser, target: { ids: string[] } | { all: true } | { kinds: NotificationKind[] }): Promise<void> {
  if ('kinds' in target) {
    await deps.db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND kind = ANY($2) AND read_at IS NULL`, [v.userId, target.kinds]);
    return;
  }
  if ('all' in target) {
    await deps.db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [v.userId]);
    return;
  }
  const r = await deps.db.query(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE user_id = $1 AND id = ANY($2)`, [v.userId, target.ids]);
  if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'No such notification.');
}
