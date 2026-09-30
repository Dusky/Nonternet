import { MAIL_MAX_PEOPLE, type MailMessageView, type MailPerson, type MailThreadSummary } from '@app/shared';
import { audit } from './audit';
import { newId } from './crypto';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { Ctx, SessionUser } from './accounts';

// Private mail (docs/10, Q11 decided 2026-09-30): conversations between two people or small groups, on this
// site only. Only confirmed users take part. Blocking someone keeps them out of new conversations with you
// and hides their messages from you in groups you already share. Sending mail is not audited (it is private);
// reports and blocks are the only things admins ever see, and a report shows only the one message.

export const MAX_PEOPLE = MAIL_MAX_PEOPLE;
const NEW_THREADS_PER_DAY_FOR_USERS = 20; // trusted people and admins have no daily cap (docs/03 guardrails)


function mayMail(user: SessionUser) {
  if (user.role === 'guest') throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address to send mail.');
}

async function lookupPeople(q: Queryable, me: SessionUser, handles: string[]): Promise<{ id: string; handle: string }[]> {
  const wanted = [...new Set(handles.map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))];
  const r = await q.query<{ id: string; handle: string; role: string; status: string }>(
    `SELECT id, handle, role, status FROM users WHERE lower(handle) = ANY($1)`, [wanted]);
  const found = new Map(r.rows.map((u) => [u.handle.toLowerCase(), u]));
  for (const h of wanted) {
    const u = found.get(h);
    if (!u || u.status !== 'active' || u.role === 'guest') throw new ApiError(404, 'no_such_person', `There is nobody called ${h} who can get mail.`);
    if (u.id === me.userId) throw new ApiError(400, 'self', 'You are already in the conversation.');
  }
  const people = wanted.map((h) => found.get(h)!);
  // Either side having blocked the other keeps them apart. The message doesn't say which side, so a block isn't revealed.
  const blocked = await q.query<{ other: string }>(
    `SELECT CASE WHEN user_id = $1 THEN blocked_id ELSE user_id END AS other FROM user_blocks
     WHERE (user_id = $1 AND blocked_id = ANY($2)) OR (blocked_id = $1 AND user_id = ANY($2))`, [me.userId, people.map((p) => p.id)]);
  if (blocked.rowCount) {
    const who = people.find((p) => p.id === blocked.rows[0]!.other)!;
    throw new ApiError(403, 'cannot_mail', `You can't send mail to ${who.handle}.`);
  }
  return people.map((p) => ({ id: p.id, handle: p.handle }));
}

export async function startThread(deps: AppDeps, me: SessionUser, input: { to: string[]; subject: string; body: string }): Promise<{ id: string }> {
  mayMail(me);
  if (me.role === 'user') {
    const n = Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM mail_threads WHERE created_by = $1 AND created_at > now() - interval '1 day'`, [me.userId])).rows[0]!.n);
    if (n >= NEW_THREADS_PER_DAY_FOR_USERS) throw new ApiError(429, 'too_many_threads', 'You have started a lot of conversations today. Try again tomorrow, or reply in one you have.');
  }
  const id = newId('mt');
  await deps.db.tx(async (q) => {
    const people = await lookupPeople(q, me, input.to);
    if (people.length === 0) throw new ApiError(400, 'no_one', 'Who is it for?');
    if (people.length + 1 > MAX_PEOPLE) throw new ApiError(400, 'too_many_people', `A conversation can have up to ${MAX_PEOPLE} people.`);
    await q.query(`INSERT INTO mail_threads (id, subject, created_by) VALUES ($1, $2, $3)`, [id, input.subject, me.userId]);
    for (const uid of [me.userId, ...people.map((p) => p.id)]) {
      await q.query(`INSERT INTO mail_participants (thread_id, user_id, last_read_at) VALUES ($1, $2, $3)`, [id, uid, uid === me.userId ? new Date() : null]);
    }
    await q.query(`INSERT INTO mail_messages (id, thread_id, author_id, body) VALUES ($1, $2, $3, $4)`, [newId('mm'), id, me.userId, input.body]);
  });
  return { id };
}

async function requireParticipant(q: Queryable, threadId: string, userId: string): Promise<{ joined_at: Date; left_at: Date | null }> {
  const r = await q.query<{ joined_at: Date; left_at: Date | null }>(`SELECT joined_at, left_at FROM mail_participants WHERE thread_id = $1 AND user_id = $2`, [threadId, userId]);
  // Not being in a conversation looks the same as it not existing.
  if (!r.rows[0]) throw new ApiError(404, 'not_found', 'No such conversation.');
  return r.rows[0];
}

export async function reply(deps: AppDeps, me: SessionUser, threadId: string, body: string): Promise<{ id: string }> {
  mayMail(me);
  const id = newId('mm');
  await deps.db.tx(async (q) => {
    const p = await requireParticipant(q, threadId, me.userId);
    if (p.left_at) throw new ApiError(403, 'left', 'You left this conversation.');
    await q.query(`INSERT INTO mail_messages (id, thread_id, author_id, body) VALUES ($1, $2, $3, $4)`, [id, threadId, me.userId, body]);
    await q.query(`UPDATE mail_threads SET last_message_at = now() WHERE id = $1`, [threadId]);
    await q.query(`UPDATE mail_participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2`, [threadId, me.userId]);
  });
  return { id };
}

export async function addPerson(deps: AppDeps, me: SessionUser, threadId: string, handle: string): Promise<void> {
  mayMail(me);
  await deps.db.tx(async (q) => {
    const p = await requireParticipant(q, threadId, me.userId);
    if (p.left_at) throw new ApiError(403, 'left', 'You left this conversation.');
    const [person] = await lookupPeople(q, me, [handle]);
    // Everyone already there must be able to be with them too.
    const clash = await q.query(
      `SELECT 1 FROM mail_participants mp JOIN user_blocks b ON (b.user_id = mp.user_id AND b.blocked_id = $2) OR (b.blocked_id = mp.user_id AND b.user_id = $2)
       WHERE mp.thread_id = $1 AND mp.left_at IS NULL`, [threadId, person!.id]);
    if (clash.rowCount) throw new ApiError(403, 'cannot_mail', `${person!.handle} can't be added to this conversation.`);
    const count = Number((await q.query<{ n: string }>(`SELECT count(*) AS n FROM mail_participants WHERE thread_id = $1 AND left_at IS NULL`, [threadId])).rows[0]!.n);
    const existing = await q.query<{ left_at: Date | null }>(`SELECT left_at FROM mail_participants WHERE thread_id = $1 AND user_id = $2`, [threadId, person!.id]);
    if (existing.rows[0] && !existing.rows[0].left_at) throw new ApiError(409, 'already_in', `${person!.handle} is already here.`);
    if (count + 1 > MAX_PEOPLE) throw new ApiError(400, 'too_many_people', `A conversation can have up to ${MAX_PEOPLE} people.`);
    if (existing.rows[0]) await q.query(`UPDATE mail_participants SET left_at = NULL, joined_at = now(), last_read_at = NULL WHERE thread_id = $1 AND user_id = $2`, [threadId, person!.id]);
    else await q.query(`INSERT INTO mail_participants (thread_id, user_id) VALUES ($1, $2)`, [threadId, person!.id]);
    await q.query(`INSERT INTO mail_messages (id, thread_id, author_id, kind, body) VALUES ($1, $2, $3, 'joined', $4)`, [newId('mm'), threadId, person!.id, me.handle]);
    await q.query(`UPDATE mail_threads SET last_message_at = now() WHERE id = $1`, [threadId]);
  });
}

export async function leave(deps: AppDeps, me: SessionUser, threadId: string): Promise<void> {
  await deps.db.tx(async (q) => {
    const p = await requireParticipant(q, threadId, me.userId);
    if (p.left_at) return;
    await q.query(`UPDATE mail_participants SET left_at = now() WHERE thread_id = $1 AND user_id = $2`, [threadId, me.userId]);
    await q.query(`INSERT INTO mail_messages (id, thread_id, author_id, kind) VALUES ($1, $2, $3, 'left')`, [newId('mm'), threadId, me.userId]);
  });
}

export async function listThreads(deps: AppDeps, me: SessionUser): Promise<{ threads: MailThreadSummary[]; unread: number }> {
  const r = await deps.db.query<{ id: string; subject: string; last_message_at: Date; last_read_at: Date | null; left_at: Date | null; joined_at: Date }>(
    `SELECT t.id, t.subject, t.last_message_at, p.last_read_at, p.left_at, p.joined_at
     FROM mail_participants p JOIN mail_threads t ON t.id = p.thread_id
     WHERE p.user_id = $1 ORDER BY t.last_message_at DESC LIMIT 200`, [me.userId]);
  const threads: MailThreadSummary[] = [];
  for (const t of r.rows) {
    const people = await peopleIn(deps.db, t.id);
    const last = await deps.db.query<{ handle: string | null; body: string; deleted_at: Date | null; created_at: Date; author_id: string | null }>(
      `SELECT u.handle, m.body, m.deleted_at, m.created_at, m.author_id FROM mail_messages m LEFT JOIN users u ON u.id = m.author_id
       WHERE m.thread_id = $1 AND m.kind = 'message' AND m.created_at >= $2 AND ($3::timestamptz IS NULL OR m.created_at <= $3)
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.user_id = $4 AND b.blocked_id = m.author_id)
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1`, [t.id, t.joined_at, t.left_at, me.userId]);
    const l = last.rows[0];
    threads.push({
      id: t.id, subject: t.subject, people, last_message_at: t.last_message_at.toISOString(), left: t.left_at !== null,
      unread: !t.left_at && !!l && l.author_id !== me.userId && (!t.last_read_at || l.created_at > t.last_read_at),
      last: l ? { author: l.handle, excerpt: l.deleted_at ? '' : [...l.body].slice(0, 120).join('') } : null,
    });
  }
  return { threads, unread: threads.filter((t) => t.unread).length };
}

async function peopleIn(q: Queryable, threadId: string): Promise<MailPerson[]> {
  const r = await q.query<{ id: string; handle: string; display_name: string | null; status: string }>(
    `SELECT u.id, u.handle, u.display_name, u.status FROM mail_participants p JOIN users u ON u.id = p.user_id
     WHERE p.thread_id = $1 AND p.left_at IS NULL ORDER BY p.joined_at, u.handle`, [threadId]);
  return r.rows.map((u) => (u.status === 'deleted' ? { id: null, handle: null, display_name: null } : { id: u.id, handle: u.handle, display_name: u.display_name }));
}

export async function readThread(deps: AppDeps, me: SessionUser, threadId: string): Promise<{ id: string; subject: string; people: MailPerson[]; left: boolean; messages: MailMessageView[] }> {
  const p = await requireParticipant(deps.db, threadId, me.userId);
  const t = (await deps.db.query<{ subject: string }>(`SELECT subject FROM mail_threads WHERE id = $1`, [threadId])).rows[0]!;
  // Someone added later reads from when they joined; someone who left reads up to when they left.
  const r = await deps.db.query<{ id: string; kind: MailMessageView['kind']; author_id: string | null; handle: string | null; display_name: string | null; status: string | null; body: string; deleted_at: Date | null; created_at: Date }>(
    `SELECT m.id, m.kind, m.author_id, u.handle, u.display_name, u.status, m.body, m.deleted_at, m.created_at
     FROM mail_messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.thread_id = $1 AND m.created_at >= $2 AND ($3::timestamptz IS NULL OR m.created_at <= $3)
       AND NOT (m.kind = 'message' AND EXISTS (SELECT 1 FROM user_blocks b WHERE b.user_id = $4 AND b.blocked_id = m.author_id))
     ORDER BY m.created_at, m.id LIMIT 1000`, [threadId, p.joined_at, p.left_at, me.userId]);
  if (!p.left_at) await deps.db.query(`UPDATE mail_participants SET last_read_at = now() WHERE thread_id = $1 AND user_id = $2`, [threadId, me.userId]);
  return {
    id: threadId, subject: t.subject, people: await peopleIn(deps.db, threadId), left: p.left_at !== null,
    messages: r.rows.map((m) => {
      const gone = !m.author_id || m.status === 'deleted';
      return {
        id: m.id, kind: m.kind, at: m.created_at.toISOString(), deleted: m.deleted_at !== null, mine: m.author_id === me.userId,
        author: gone ? { id: null, handle: null, display_name: null } : { id: m.author_id, handle: m.handle, display_name: m.display_name },
        body: m.deleted_at ? '' : m.body,
      };
    }),
  };
}

export async function deleteMessage(deps: AppDeps, me: SessionUser, threadId: string, messageId: string): Promise<void> {
  const r = await deps.db.query(
    `UPDATE mail_messages SET deleted_at = now(), body = '' WHERE id = $1 AND thread_id = $2 AND author_id = $3 AND kind = 'message' AND deleted_at IS NULL`,
    [messageId, threadId, me.userId]);
  if (!r.rowCount) throw new ApiError(404, 'not_found', 'You have no message like that here.');
}

export async function unreadMail(deps: AppDeps, me: SessionUser): Promise<number> {
  const r = await deps.db.query<{ n: string }>(
    `SELECT count(*) AS n FROM mail_participants p WHERE p.user_id = $1 AND p.left_at IS NULL AND EXISTS (
       SELECT 1 FROM mail_messages m WHERE m.thread_id = p.thread_id AND m.kind = 'message' AND m.author_id IS DISTINCT FROM $1
         AND m.created_at >= p.joined_at AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.user_id = $1 AND b.blocked_id = m.author_id))`, [me.userId]);
  return Number(r.rows[0]!.n);
}

// ---------------------------------------------------------------- blocks

export async function listBlocks(deps: AppDeps, me: SessionUser): Promise<{ handle: string; since: string }[]> {
  const r = await deps.db.query<{ handle: string; created_at: Date }>(
    `SELECT u.handle, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = $1 ORDER BY u.handle`, [me.userId]);
  return r.rows.map((b) => ({ handle: b.handle, since: b.created_at.toISOString() }));
}

export async function block(deps: AppDeps, me: SessionUser, handle: string): Promise<void> {
  const u = (await deps.db.query<{ id: string; role: string }>(`SELECT id, role FROM users WHERE lower(handle) = lower($1) AND status <> 'deleted'`, [handle])).rows[0];
  if (!u) throw new ApiError(404, 'no_such_person', 'Nobody goes by that name.');
  if (u.id === me.userId) throw new ApiError(400, 'self', "You can't block yourself.");
  if (u.role === 'admin') throw new ApiError(400, 'admin', "Admins can't be blocked, so they can always reach you about your account.");
  await deps.db.query(`INSERT INTO user_blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [me.userId, u.id]);
}

export async function unblock(deps: AppDeps, me: SessionUser, handle: string): Promise<void> {
  await deps.db.query(`DELETE FROM user_blocks WHERE user_id = $1 AND blocked_id = (SELECT id FROM users WHERE lower(handle) = lower($2))`, [me.userId, handle]);
}

// ---------------------------------------------------------------- reports

export async function reportMessage(deps: AppDeps, me: SessionUser, threadId: string, messageId: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  await requireParticipant(deps.db, threadId, me.userId);
  const m = await deps.db.query<{ author_id: string | null }>(`SELECT author_id FROM mail_messages WHERE id = $1 AND thread_id = $2 AND kind = 'message' AND deleted_at IS NULL`, [messageId, threadId]);
  if (!m.rows[0] || !m.rows[0].author_id) throw new ApiError(404, 'not_found', 'No such message.');
  if (m.rows[0].author_id === me.userId) throw new ApiError(400, 'self', "You can't report your own message.");
  const id = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      // Reporting shares that one message with the admins, and nothing else of the conversation.
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, 'mail_message', $2, 'site', 'site', $3, $4, $5)`,
        [id, messageId, me.userId, category, note]);
      await audit(q, { actorId: me.userId, actorKind: 'user', action: 'report.created', targetType: 'mail_message', targetId: messageId, after: { category }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'reports_one_open') throw new ApiError(409, 'already_reported', 'You already reported this. The admins have it.');
    throw err;
  }
  return { id };
}
