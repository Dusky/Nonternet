import { UNDOABLE_MOD_ACTIONS, type ModAction, type ModLogEntry, type PostView, type ReportCategory, type ReportView } from '@app/shared';
import { audit } from './audit';
import { newId } from './crypto';
import { isUniqueViolation, type Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { emit } from './events';
import { canModerate, isMember, loadBoard, viewerOf, type BoardRow } from './boards';
import * as admin from './admin';
import type { Ctx, SessionUser } from './accounts';

interface PostRow {
  id: string; board_id: string; author_id: string | null; thread_root_id: string | null;
  hidden_at: Date | null; deleted_at: Date | null; locked_at: Date | null; slug: string;
}

// Loads a post for changing. A post on a board the actor cannot read does not exist for them, and a
// post on a board they cannot moderate is not theirs to act on.
async function lockPost(q: Queryable, v: SessionUser, postId: string): Promise<{ post: PostRow; board: BoardRow }> {
  const r = await q.query<PostRow>(
    `SELECT p.id, p.board_id, p.author_id, p.thread_root_id, p.hidden_at, p.deleted_at, p.locked_at, b.slug
     FROM posts p JOIN boards b ON b.id = p.board_id WHERE p.id = $1 FOR UPDATE OF p`, [postId]);
  const post = r.rows[0];
  if (!post) throw new ApiError(404, 'not_found', 'No such post.');
  const board = await loadBoard(q, post.slug, viewerOf(v));
  if (!canModerate(v, board)) throw new ApiError(403, 'forbidden', 'Only the board owner, its ops and admins can do that.');
  return { post, board };
}

// A hidden or removed reply stops counting toward its thread's replies, and comes back when it is restored.
const adjustReplies = (q: Queryable, post: PostRow, by: 1 | -1) =>
  post.thread_root_id ? q.query(`UPDATE posts SET reply_count = GREATEST(reply_count + $2, 0) WHERE id = $1`, [post.thread_root_id, by]) : Promise.resolve();

// When a moderator hides or removes a post, the reports about it have been dealt with.
async function closeReports(q: Queryable, v: SessionUser, postId: string, note: string): Promise<void> {
  await q.query(
    `UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = $3
     WHERE target_type = 'post' AND target_id = $1 AND status = 'open'`, [postId, v.userId, note]);
}

export interface ModInput { action: ModAction; post_id: string; reason: string; to_board?: string }

export async function modAction(deps: AppDeps, v: SessionUser, input: ModInput, ctx: Ctx, undoes?: string): Promise<{ id: string }> {
  return deps.db.tx(async (q) => {
    const { post, board } = await lockPost(q, v, input.post_id);
    const gone = () => new ApiError(409, 'gone', 'That post was already removed.');
    const same = (what: string) => new ApiError(409, 'no_change', what);
    let detail: Record<string, unknown> | null = null;
    let boardId = board.id;

    switch (input.action) {
      case 'hide':
        if (post.deleted_at) throw gone();
        if (post.hidden_at) throw same('That post is already hidden.');
        await q.query(`UPDATE posts SET hidden_at = now() WHERE id = $1`, [post.id]);
        await adjustReplies(q, post, -1);
        await closeReports(q, v, post.id, `Hidden by a moderator: ${input.reason}`);
        break;
      case 'unhide':
        if (post.deleted_at) throw gone();
        if (!post.hidden_at) throw same('That post is not hidden.');
        await q.query(`UPDATE posts SET hidden_at = NULL WHERE id = $1`, [post.id]);
        await adjustReplies(q, post, 1);
        break;
      case 'remove':
        if (post.deleted_at) throw gone();
        await q.query(`UPDATE posts SET deleted_at = now(), deleted_by = 'moderator', subject = '', body = '' WHERE id = $1`, [post.id]);
        if (!post.hidden_at) await adjustReplies(q, post, -1);
        await closeReports(q, v, post.id, `Removed by a moderator: ${input.reason}`);
        break;
      case 'lock':
      case 'unlock': {
        if (post.thread_root_id) throw new ApiError(409, 'not_a_thread', 'Only a whole thread can be locked.');
        const lock = input.action === 'lock';
        if (lock === (post.locked_at !== null)) throw same(lock ? 'That thread is already locked.' : 'That thread is not locked.');
        await q.query(`UPDATE posts SET locked_at = ${lock ? 'now()' : 'NULL'} WHERE id = $1`, [post.id]);
        break;
      }
      case 'move': {
        if (post.thread_root_id) throw new ApiError(409, 'not_a_thread', 'Only a whole thread can be moved.');
        const dest = await loadBoard(q, input.to_board!, viewerOf(v));
        if (dest.id === board.id) throw same('That thread is already on that board.');
        if (board.visibility === 'ring') throw new ApiError(409, 'ring_board', 'Threads cannot be moved off a ring board.');
        // Moving puts a thread in front of a different audience, so the mover must be in charge of both boards.
        if (!canModerate(v, dest)) throw new ApiError(403, 'forbidden', 'You can only move a thread to a board you moderate.');
        if (dest.archived_at) throw new ApiError(409, 'archived', 'That board is archived.');
        if (dest.visibility === 'ring') throw new ApiError(409, 'ring_board', 'Threads cannot be moved onto a ring board.');
        const ids = (await q.query<{ id: string }>(`SELECT id FROM posts WHERE id = $1 OR thread_root_id = $1`, [post.id])).rows.map((x) => x.id);
        await q.query(`UPDATE posts SET board_id = $2 WHERE id = ANY($1)`, [ids, dest.id]);
        await q.query(`UPDATE notifications SET board_id = $2 WHERE post_id = ANY($1)`, [ids, dest.id]);
        await q.query(`UPDATE reports SET scope_id = $2 WHERE target_type = 'post' AND target_id = ANY($1)`, [ids, dest.id]);
        detail = { from: board.slug, to: dest.slug };
        boardId = board.id; // the log entry stays with the board it was moved from, so its ops can see it happen
        break;
      }
    }

    const id = newId('m');
    await q.query(`INSERT INTO mod_actions (id, board_id, actor_id, action, post_id, reason, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, boardId, v.userId, input.action, post.id, input.reason, detail ? JSON.stringify(detail) : null]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: `mod.${input.action}`, targetType: 'post', targetId: post.id,
      after: { board: board.slug, reason: input.reason, ...(detail ?? {}), ...(undoes ? { undoes } : {}) }, origin: 'web', ipHash: ctx.ipHash });
    await emit(q, 'mod.action', { action: input.action, board_id: boardId, post_id: post.id, actor_id: v.userId });
    return { id };
  });
}

// What undoes what. A removal cannot be undone: the text is gone.
const INVERSE: Partial<Record<ModAction, ModAction>> = { hide: 'unhide', lock: 'unlock', move: 'move' };

export async function undoModAction(deps: AppDeps, v: SessionUser, actionId: string, reason: string | undefined, ctx: Ctx): Promise<{ id: string }> {
  const r = await deps.db.query<{ id: string; action: ModAction; post_id: string; detail: { from?: string } | null; undone_at: Date | null; board_id: string }>(
    `SELECT id, action, post_id, detail, undone_at, board_id FROM mod_actions WHERE id = $1`, [actionId]);
  const a = r.rows[0];
  if (!a) throw new ApiError(404, 'not_found', 'No such action.');
  if (!UNDOABLE_MOD_ACTIONS.includes(a.action)) throw new ApiError(409, 'not_undoable', 'That cannot be undone.');
  if (a.undone_at) throw new ApiError(409, 'no_change', 'That was already undone.');
  const inverse = INVERSE[a.action]!;
  const made = await modAction(deps, v, { action: inverse, post_id: a.post_id, reason: reason ?? `Undo ${a.action}`, to_board: inverse === 'move' ? a.detail?.from : undefined }, ctx, actionId);
  await deps.db.query(`UPDATE mod_actions SET undone_at = now(), undone_by = $2 WHERE id = $1`, [actionId, v.userId]);
  return made;
}

// ---------------------------------------------------------------- the mod log

export async function modLog(deps: AppDeps, v: SessionUser | null, opts: { board?: string; before?: string; limit?: number }): Promise<{ entries: ModLogEntry[]; next: string | null }> {
  const viewer = viewerOf(v);
  let boardId: string | null = null;
  if (opts.board) {
    const b = await loadBoard(deps.db, opts.board, viewer);
    if (!deps.config.moderation.public_modlog && !canModerate(viewer, b)) throw new ApiError(403, 'forbidden', 'This site keeps the mod log for moderators only.');
    boardId = b.id;
  } else if (viewer?.role !== 'admin') {
    throw new ApiError(400, 'board_required', 'Choose a board.');
  }
  const limit = Math.min(opts.limit ?? 50, 100);
  const r = await deps.db.query<{
    id: string; created_at: Date; action: ModAction; reason: string; undone_at: Date | null; detail: Record<string, unknown> | null; post_id: string;
    actor: string; slug: string; board_name: string; post_author: string | null;
  }>(
    `SELECT m.id, m.created_at, m.action, m.reason, m.undone_at, m.detail, m.post_id, a.handle AS actor, b.slug, b.name AS board_name, pa.handle AS post_author
     FROM mod_actions m JOIN users a ON a.id = m.actor_id JOIN boards b ON b.id = m.board_id
       JOIN posts p ON p.id = m.post_id LEFT JOIN users pa ON pa.id = p.author_id
     WHERE ($1::text IS NULL OR m.board_id = $1)
       AND ($2::text IS NULL OR (m.created_at, m.id) < (SELECT created_at, id FROM mod_actions WHERE id = $2))
     ORDER BY m.created_at DESC, m.id DESC LIMIT $3`,
    [boardId, opts.before ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  return {
    entries: page.map((x) => ({
      id: x.id, at: x.created_at.toISOString(), action: x.action, reason: x.reason, undone: x.undone_at !== null,
      undoable: UNDOABLE_MOD_ACTIONS.includes(x.action) && x.undone_at === null,
      actor: { handle: x.actor }, board: { slug: x.slug, name: x.board_name }, post_id: x.post_id, post_author: x.post_author, detail: x.detail,
    })),
    next: r.rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

// ---------------------------------------------------------------- reports

export async function createReport(deps: AppDeps, v: SessionUser, input: { post_id: string; category: ReportCategory; note: string }, ctx: Ctx): Promise<{ id: string }> {
  if (!isMember(v)) throw new ApiError(403, 'email_not_verified', 'Confirm your email address to report a post.');
  const id = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      const p = await q.query<{ id: string; author_id: string | null; deleted_at: Date | null; board_id: string; slug: string }>(
        `SELECT p.id, p.author_id, p.deleted_at, p.board_id, b.slug FROM posts p JOIN boards b ON b.id = p.board_id WHERE p.id = $1`, [input.post_id]);
      const post = p.rows[0];
      if (!post) throw new ApiError(404, 'not_found', 'No such post.');
      await loadBoard(q, post.slug, viewerOf(v)); // you can only report what you can see
      if (post.deleted_at) throw new ApiError(409, 'gone', 'That post was already removed.');
      if (post.author_id === v.userId) throw new ApiError(409, 'own_post', 'That is your own post. You can delete it instead.');
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, 'post', $2, 'board', $3, $4, $5, $6)`,
        [id, post.id, post.board_id, v.userId, input.category, input.note]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.created', targetType: 'post', targetId: post.id, after: { category: input.category }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'reports_one_open')) throw new ApiError(409, 'already_reported', 'You already reported this post. The moderators have it.');
    throw err;
  }
  return { id };
}

// Reports go to the ops of the board first. Admins see all of them, and can tell which have waited
// more than a day without an answer (docs/03).
const ESCALATE_AFTER_MS = 24 * 3600 * 1000;

async function boardsIModerate(q: Queryable, v: SessionUser): Promise<string[] | 'all'> {
  if (v.role === 'admin') return 'all';
  const ids = new Set(v.ops.filter((o) => o.startsWith('board:')).map((o) => o.slice('board:'.length)));
  const owned = await q.query<{ id: string }>(`SELECT id FROM boards WHERE owner_id = $1`, [v.userId]);
  for (const b of owned.rows) ids.add(b.id);
  const rings = v.ops.filter((o) => o.startsWith('ring:')).map((o) => o.slice('ring:'.length));
  if (rings.length) for (const b of (await q.query<{ id: string }>(`SELECT id FROM boards WHERE ring_id = ANY($1)`, [rings])).rows) ids.add(b.id);
  return [...ids];
}

interface ReportRow {
  id: string; status: ReportView['status']; category: ReportCategory; note: string; created_at: Date; reporter: string;
  resolved_by: string | null; resolved_at: Date | null; resolution_note: string | null; target_type: ReportView['target']['type']; target_id: string;
  slug: string | null; board_name: string | null; thread_id: string | null; subject: string | null; body: string | null; deleted_at: Date | null;
  deleted_by: string | null; hidden_at: Date | null; post_author: string | null; handle: string | null; page_title: string | null; entry_message: string | null; mail_body: string | null; mail_author: string | null; file_name: string | null; file_title: string | null; other_open: string;
}

export async function listReports(deps: AppDeps, v: SessionUser, opts: { status?: 'open' | 'actioned' | 'dismissed' | 'all'; board?: string; before?: string; limit?: number }): Promise<{ reports: ReportView[]; next: string | null }> {
  const mine = await boardsIModerate(deps.db, v);
  if (mine !== 'all' && mine.length === 0) throw new ApiError(403, 'forbidden', 'Only moderators can see reports.');
  const status = opts.status ?? 'open';
  const limit = Math.min(opts.limit ?? 30, 100);
  const r = await deps.db.query<ReportRow>(
    `SELECT r.id, r.status, r.category, r.note, r.created_at, ru.handle AS reporter, r.resolved_by, r.resolved_at, r.resolution_note, r.target_type, r.target_id,
            b.slug, b.name AS board_name, COALESCE(p.thread_root_id, p.id) AS thread_id,
            (SELECT subject FROM posts t WHERE t.id = COALESCE(p.thread_root_id, p.id)) AS subject, p.body,
            p.deleted_at, p.deleted_by, p.hidden_at, pa.handle AS post_author,
            COALESCE(hu.handle, gu.handle, mu.handle, fu.handle) AS handle, hp.title AS page_title, ge.message AS entry_message,
            mm.body AS mail_body, mu.handle AS mail_author, fi.name AS file_name, fi.title AS file_title,
            (SELECT count(*) FROM reports o WHERE o.target_type = r.target_type AND o.target_id = r.target_id AND o.status = 'open' AND o.id <> r.id) AS other_open
     FROM reports r JOIN users ru ON ru.id = r.reporter_id
       LEFT JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
       LEFT JOIN boards b ON b.id = p.board_id
       LEFT JOIN users pa ON pa.id = p.author_id
       LEFT JOIN users hu ON r.target_type = 'homepage' AND hu.id = r.target_id
       LEFT JOIN homepages hp ON hp.user_id = hu.id
       LEFT JOIN guestbook_entries ge ON r.target_type = 'guestbook' AND ge.id = r.target_id
       LEFT JOIN users gu ON gu.id = ge.home_user_id
       LEFT JOIN mail_messages mm ON r.target_type = 'mail_message' AND mm.id = r.target_id
       LEFT JOIN users mu ON mu.id = mm.author_id
       LEFT JOIN files fi ON r.target_type = 'file' AND fi.id = r.target_id
       LEFT JOIN users fu ON fu.id = fi.uploader_id
     WHERE ($1::text = 'all' OR r.status = $1)
       AND ($2::text[] IS NULL OR (r.scope_type = 'board' AND r.scope_id = ANY($2)))
       AND ($3::text IS NULL OR b.slug = $3)
       AND ($4::text IS NULL OR (r.created_at, r.id) < (SELECT created_at, id FROM reports WHERE id = $4))
     ORDER BY r.created_at DESC, r.id DESC LIMIT $5`,
    [status, mine === 'all' ? null : mine, opts.board ?? null, opts.before ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  const now = deps.now();
  return {
    reports: page.map((x): ReportView => {
      const isPost = x.target_type === 'post';
      const state: PostView['state'] = x.deleted_at ? (x.deleted_by === 'moderator' ? 'removed' : 'deleted') : x.hidden_at ? 'hidden' : 'ok';
      return {
        id: x.id, status: x.status, category: x.category, note: x.note, at: x.created_at.toISOString(),
        escalated: x.status === 'open' && now - x.created_at.getTime() > ESCALATE_AFTER_MS, other_open: Number(x.other_open),
        reporter: { handle: x.reporter }, board: { slug: x.slug ?? '', name: x.board_name ?? '' },
        target: { type: x.target_type, id: x.target_id, handle: x.handle },
        post: isPost ? { id: x.target_id, thread_id: x.thread_id ?? '', subject: x.deleted_at ? '' : x.subject ?? '', excerpt: '', state, author: x.post_author } : null,
        excerpt: isPost ? (x.deleted_at ? '' : [...(x.body ?? '')].slice(0, 300).join('')) : x.target_type === 'guestbook' ? [...(x.entry_message ?? '')].slice(0, 300).join('')
          : x.target_type === 'mail_message' ? [...(x.mail_body ?? '')].slice(0, 600).join('')
          : x.target_type === 'file' ? [x.file_name, x.file_title].filter(Boolean).join(' — ') : x.page_title ?? '',
        resolved_by: x.resolved_by, resolved_at: x.resolved_at ? x.resolved_at.toISOString() : null, resolution_note: x.resolution_note,
      };
    }),
    next: r.rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

export async function resolveReport(deps: AppDeps, v: SessionUser, id: string, resolution: 'actioned' | 'dismissed', note: string | undefined, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ id: string; status: string; scope_id: string; target_id: string }>(`SELECT id, status, scope_id, target_id FROM reports WHERE id = $1 FOR UPDATE`, [id]);
    const rep = r.rows[0];
    const mine = rep ? await boardsIModerate(q, v) : [];
    // A report you may not act on looks like one that does not exist.
    if (!rep || (mine !== 'all' && !mine.includes(rep.scope_id))) throw new ApiError(404, 'not_found', 'No such report.');
    if (rep.status !== 'open') throw new ApiError(409, 'no_change', 'That report was already dealt with.');
    await q.query(`UPDATE reports SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE id = $1`, [id, resolution, v.userId, note ?? null]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.resolved', targetType: 'post', targetId: rep.target_id, after: { report: id, resolution, note: note ?? null }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// ---------------------------------------------------------------- board ops

export async function listBoardOps(deps: AppDeps, v: SessionUser, slug: string): Promise<{ id: string; user: { id: string; handle: string } }[]> {
  const b = await loadBoard(deps.db, slug, viewerOf(v));
  if (!canModerate(v, b)) throw new ApiError(403, 'forbidden', 'Only the board owner, its ops and admins can see who the ops are.');
  const r = await deps.db.query<{ id: string; uid: string; handle: string }>(
    `SELECT s.id, u.id AS uid, u.handle FROM scoped_roles s JOIN users u ON u.id = s.user_id WHERE s.scope_type = 'board' AND s.scope_id = $1 ORDER BY u.handle`, [b.id]);
  return r.rows.map((x) => ({ id: x.id, user: { id: x.uid, handle: x.handle } }));
}

// The owner of a board and admins choose its ops (docs/03). An op can act on the board but cannot appoint more.
export async function addBoardOp(deps: AppDeps, v: SessionUser, slug: string, handle: string, reason: string | undefined, ctx: Ctx): Promise<void> {
  const b = await loadBoard(deps.db, slug, viewerOf(v));
  if (v.role !== 'admin' && v.userId !== b.owner_id) throw new ApiError(403, 'forbidden', 'Only the board owner and admins can choose ops.');
  const u = await deps.db.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1) AND status = 'active' AND role <> 'guest'`, [handle]);
  if (!u.rows[0]) throw new ApiError(404, 'not_found', 'No user has that handle.');
  await admin.grantOp(deps, v, u.rows[0].id, 'board', b.id, reason, ctx);
}

export async function removeBoardOp(deps: AppDeps, v: SessionUser, slug: string, opId: string, reason: string | undefined, ctx: Ctx): Promise<void> {
  const b = await loadBoard(deps.db, slug, viewerOf(v));
  const r = await deps.db.query<{ user_id: string }>(`SELECT user_id FROM scoped_roles WHERE id = $1 AND scope_type = 'board' AND scope_id = $2`, [opId, b.id]);
  const op = r.rows[0];
  // An op may step down themselves; taking someone else's place is for the owner and admins.
  if (!op) throw new ApiError(404, 'not_found', 'No such op on this board.');
  if (v.role !== 'admin' && v.userId !== b.owner_id && v.userId !== op.user_id) throw new ApiError(403, 'forbidden', 'Only the board owner and admins can remove ops.');
  await admin.revokeOp(deps, v, op.user_id, opId, reason, ctx);
}
