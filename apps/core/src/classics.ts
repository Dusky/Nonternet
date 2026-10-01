import { ONELINER_GAP_MINUTES, type BulletinSummary, type BulletinView, type OnelinerView, type PollSummary, type PollView } from '@app/shared';
import type { SessionUser } from './accounts';
import { audit } from './audit';
import { isMember } from './boards';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { liveAll } from './live';

// BBS classics (M9-E, docs/04, 05): a oneliners wall, numbered bulletins and a voting booth.

const member = (v: SessionUser) => { if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.'); };
const admin = (v: SessionUser) => { if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can do that.'); };
const tell = () => liveAll({ type: 'classics' }, { confirmedOnly: true });
const notFound = (what: string) => new ApiError(404, 'not_found', `No such ${what}.`);

// ---------------------------------------------------------------- oneliners

export async function listOneliners(deps: AppDeps, v: SessionUser, limit = 20): Promise<{ oneliners: OnelinerView[] }> {
  member(v);
  const r = await deps.db.query<{ id: string; author_id: string; handle: string; body: string; created_at: Date }>(
    `SELECT o.id, o.author_id, u.handle, o.body, o.created_at FROM oneliners o JOIN users u ON u.id = o.author_id
      WHERE o.hidden_at IS NULL AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.user_id = $1 AND b.blocked_id = o.author_id)
      ORDER BY o.created_at DESC, o.id DESC LIMIT $2`, [v.userId, Math.min(Math.max(limit, 1), 50)]);
  return { oneliners: r.rows.map((o) => ({ id: o.id, author: { id: o.author_id, handle: o.handle }, body: o.body, at: o.created_at.toISOString(), mine: o.author_id === v.userId })) };
}

export async function postOneliner(deps: AppDeps, v: SessionUser, body: string): Promise<OnelinerView> {
  member(v);
  if (v.limited) throw new ApiError(403, 'totp_setup_required', 'Set up two-factor authentication to continue.');
  const id = newId('ol');
  // One per person per hour, counted by the database clock. Hidden lines count too, or hiding one would let it be tried again.
  const r = await deps.db.query<{ created_at: Date }>(
    `INSERT INTO oneliners (id, author_id, body)
     SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM oneliners WHERE author_id = $2 AND created_at > now() - make_interval(mins => $4))
     RETURNING created_at`, [id, v.userId, body, ONELINER_GAP_MINUTES]);
  if (!r.rows[0]) throw new ApiError(429, 'too_soon', `You can put up one line an hour. Try again a little later.`);
  tell();
  return { id, author: { id: v.userId, handle: v.handle }, body, at: r.rows[0].created_at.toISOString(), mine: true };
}

export async function deleteOwnOneliner(deps: AppDeps, v: SessionUser, id: string): Promise<void> {
  const r = await deps.db.query(`DELETE FROM oneliners WHERE id = $1 AND author_id = $2`, [id, v.userId]);
  if (!r.rowCount) throw notFound('line');
  tell();
}

export async function hideOneliner(deps: AppDeps, v: SessionUser, id: string, hide: boolean, reason: string, ipHash?: string): Promise<void> {
  admin(v);
  await deps.db.tx(async (q) => {
    const r = await q.query<{ body: string; author_id: string }>(
      hide ? `UPDATE oneliners SET hidden_at = now(), hidden_by = $2 WHERE id = $1 AND hidden_at IS NULL RETURNING body, author_id`
           : `UPDATE oneliners SET hidden_at = NULL, hidden_by = NULL WHERE id = $1 AND hidden_at IS NOT NULL AND $2::text IS NOT NULL RETURNING body, author_id`, [id, v.userId]);
    if (!r.rows[0]) throw notFound('line');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: hide ? 'oneliner.hidden' : 'oneliner.unhidden', targetType: 'user', targetId: r.rows[0].author_id, after: { oneliner: id, text: r.rows[0].body, reason }, origin: 'web', ipHash });
  });
  tell();
}

// ---------------------------------------------------------------- bulletins

export async function listBulletins(deps: AppDeps, v: SessionUser): Promise<{ bulletins: BulletinSummary[]; unread: number }> {
  member(v);
  const seen = (await deps.db.query<{ number: number }>(`SELECT number FROM bulletin_seen WHERE user_id = $1`, [v.userId])).rows[0]?.number ?? 0;
  const r = await deps.db.query<{ id: string; number: number; title: string; created_at: Date }>(
    `SELECT id, number, title, created_at FROM bulletins WHERE hidden_at IS NULL ORDER BY number DESC LIMIT 200`);
  const bulletins = r.rows.map((b) => ({ id: b.id, number: b.number, title: b.title, at: b.created_at.toISOString(), unread: b.number > seen }));
  return { bulletins, unread: bulletins.filter((b) => b.unread).length };
}

// Reading one marks everything up to it as read: bulletins are read in order, newest last, like on a board.
export async function readBulletin(deps: AppDeps, v: SessionUser, number: number): Promise<BulletinView> {
  member(v);
  const r = await deps.db.query<{ id: string; number: number; title: string; body: string; created_at: Date; updated_at: Date | null }>(
    `SELECT id, number, title, body, created_at, updated_at FROM bulletins WHERE number = $1 AND hidden_at IS NULL`, [number]);
  const b = r.rows[0];
  if (!b) throw notFound('bulletin');
  await deps.db.query(
    `INSERT INTO bulletin_seen (user_id, number) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET number = GREATEST(bulletin_seen.number, EXCLUDED.number)`, [v.userId, number]);
  return { id: b.id, number: b.number, title: b.title, body: b.body, at: b.created_at.toISOString(), updated_at: b.updated_at?.toISOString() ?? null, unread: false };
}

export async function createBulletin(deps: AppDeps, v: SessionUser, input: { title: string; body: string }, ipHash?: string): Promise<{ number: number }> {
  admin(v);
  const id = newId('bl');
  const n = await deps.db.tx(async (q) => {
    const r = await q.query<{ number: number }>(`INSERT INTO bulletins (id, title, body, author_id) VALUES ($1, $2, $3, $4) RETURNING number`, [id, input.title, input.body, v.userId]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'bulletin.created', targetType: 'bulletin', targetId: id, after: { number: r.rows[0]!.number, title: input.title }, origin: 'web', ipHash });
    return r.rows[0]!.number;
  });
  tell();
  return { number: n };
}

export async function editBulletin(deps: AppDeps, v: SessionUser, number: number, input: { title: string; body: string }, ipHash?: string): Promise<void> {
  admin(v);
  await deps.db.tx(async (q) => {
    const r = await q.query<{ id: string }>(`UPDATE bulletins SET title = $2, body = $3, updated_at = now() WHERE number = $1 AND hidden_at IS NULL RETURNING id`, [number, input.title, input.body]);
    if (!r.rows[0]) throw notFound('bulletin');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'bulletin.edited', targetType: 'bulletin', targetId: r.rows[0].id, after: { number, title: input.title }, origin: 'web', ipHash });
  });
  tell();
}

export async function hideBulletin(deps: AppDeps, v: SessionUser, number: number, reason: string, ipHash?: string): Promise<void> {
  admin(v);
  await deps.db.tx(async (q) => {
    const r = await q.query<{ id: string }>(`UPDATE bulletins SET hidden_at = now() WHERE number = $1 AND hidden_at IS NULL RETURNING id`, [number]);
    if (!r.rows[0]) throw notFound('bulletin');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'bulletin.hidden', targetType: 'bulletin', targetId: r.rows[0].id, after: { number, reason }, origin: 'web', ipHash });
  });
  tell();
}

// ---------------------------------------------------------------- polls

const closedSql = `(p.closes_at IS NOT NULL AND p.closes_at <= now())`;

export async function listPolls(deps: AppDeps, v: SessionUser): Promise<{ polls: PollSummary[] }> {
  member(v);
  const r = await deps.db.query<{ id: string; question: string; closes_at: Date | null; closed: boolean; voted: boolean; handle: string | null }>(
    `SELECT p.id, p.question, p.closes_at, ${closedSql} AS closed, EXISTS (SELECT 1 FROM poll_votes x WHERE x.poll_id = p.id AND x.user_id = $1) AS voted, u.handle
       FROM polls p LEFT JOIN users u ON u.id = p.created_by AND u.status = 'active'
      WHERE p.hidden_at IS NULL ORDER BY p.created_at DESC, p.id DESC LIMIT 100`, [v.userId]);
  return { polls: r.rows.map((p) => ({ id: p.id, question: p.question, closes_at: p.closes_at?.toISOString() ?? null, closed: p.closed, voted: p.voted, by: p.handle })) };
}

export async function getPoll(deps: AppDeps, v: SessionUser, id: string): Promise<PollView> {
  member(v);
  const r = await deps.db.query<{ id: string; question: string; closes_at: Date | null; closed: boolean; handle: string | null; mine: string | null }>(
    `SELECT p.id, p.question, p.closes_at, ${closedSql} AS closed, u.handle, (SELECT option_id FROM poll_votes x WHERE x.poll_id = p.id AND x.user_id = $2) AS mine
       FROM polls p LEFT JOIN users u ON u.id = p.created_by AND u.status = 'active' WHERE p.id = $1 AND p.hidden_at IS NULL`, [id, v.userId]);
  const p = r.rows[0];
  if (!p) throw notFound('poll');
  const see = p.mine !== null || p.closed;
  const opts = await deps.db.query<{ id: string; label: string; votes: string }>(
    `SELECT o.id, o.label, (SELECT count(*) FROM poll_votes x WHERE x.option_id = o.id) AS votes FROM poll_options o WHERE o.poll_id = $1 ORDER BY o.position`, [id]);
  const total = opts.rows.reduce((n, o) => n + Number(o.votes), 0);
  return {
    id: p.id, question: p.question, closes_at: p.closes_at?.toISOString() ?? null, closed: p.closed, voted: p.mine !== null, by: p.handle,
    options: opts.rows.map((o) => ({ id: o.id, label: o.label, votes: see ? Number(o.votes) : null })), my_vote: p.mine, total: see ? total : null, can_see_results: see,
  };
}

export async function createPoll(deps: AppDeps, v: SessionUser, input: { question: string; options: string[]; closes_in_days?: number }): Promise<{ id: string }> {
  member(v);
  if (v.role !== 'admin' && v.role !== 'trusted') throw new ApiError(403, 'forbidden', 'Only trusted people and admins can ask the site a question.');
  const id = newId('pl');
  await deps.db.tx(async (q) => {
    await q.query(`INSERT INTO polls (id, question, created_by, closes_at) VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END)`, [id, input.question, v.userId, input.closes_in_days ?? null]);
    for (const [i, label] of input.options.entries()) await q.query(`INSERT INTO poll_options (id, poll_id, label, position) VALUES ($1, $2, $3, $4)`, [newId('po'), id, label, i]);
  });
  tell();
  return { id };
}

export async function vote(deps: AppDeps, v: SessionUser, pollId: string, optionId: string): Promise<PollView> {
  member(v);
  if (v.limited) throw new ApiError(403, 'totp_setup_required', 'Set up two-factor authentication to continue.');
  await deps.db.tx(async (q) => {
    const p = await q.query<{ closed: boolean }>(`SELECT ${closedSql} AS closed FROM polls p WHERE p.id = $1 AND p.hidden_at IS NULL`, [pollId]);
    if (!p.rows[0]) throw notFound('poll');
    if (p.rows[0].closed) throw new ApiError(409, 'closed', 'That poll has closed.');
    const o = await q.query(`SELECT 1 FROM poll_options WHERE id = $1 AND poll_id = $2`, [optionId, pollId]);
    if (!o.rowCount) throw new ApiError(400, 'bad_option', 'That is not one of the choices.');
    const r = await q.query(`INSERT INTO poll_votes (poll_id, user_id, option_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [pollId, v.userId, optionId]);
    if (!r.rowCount) throw new ApiError(409, 'already_voted', 'You have already voted in this poll.');
  });
  tell();
  return getPoll(deps, v, pollId);
}

export async function hidePoll(deps: AppDeps, v: SessionUser, id: string, reason: string, ipHash?: string): Promise<void> {
  admin(v);
  await deps.db.tx(async (q) => {
    const r = await q.query<{ question: string; created_by: string | null }>(`UPDATE polls SET hidden_at = now() WHERE id = $1 AND hidden_at IS NULL RETURNING question, created_by`, [id]);
    if (!r.rows[0]) throw notFound('poll');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'poll.hidden', targetType: 'poll', targetId: id, after: { question: r.rows[0].question, reason }, origin: 'web', ipHash });
  });
  tell();
}
