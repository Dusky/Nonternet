import { MAX_RING_MEMBERSHIPS, type JoinPolicy, type MemberStatus, type RingDetail, type RingMemberView, type RingNav, type RingSummary } from '@app/shared';
import { audit } from './audit';
import { newId } from './crypto';
import { isUniqueViolation, type Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { emit } from './events';
import * as admin from './admin';
import { finishOpsChange } from './admin';
import { opsFor, type Ctx, type SessionUser } from './accounts';
import type { Viewer } from './boards';

const notFound = () => new ApiError(404, 'not_found', 'No such ring.');
const NAV_SEEN_DAYS = 30;

interface RingRow {
  id: string; slug: string; name: string; description: string; about: string; tags: string[]; join_policy: JoinPolicy;
  founder_id: string; founder_handle: string; board_id: string | null; board_slug: string | null; archived_at: Date | null; hidden_at: Date | null; created_at: Date;
  member_count: string; activity: string; my_status: MemberStatus | null;
}

const SUMMARY_SQL = `
  SELECT r.id, r.slug, r.name, r.description, r.about, r.tags, r.join_policy, r.founder_id, f.handle AS founder_handle,
    r.board_id, b.slug AS board_slug, r.archived_at, r.hidden_at, r.created_at,
    (SELECT count(*) FROM ring_members m WHERE m.ring_id = r.id AND m.status = 'member') AS member_count,
    (SELECT count(*) FROM ring_members m WHERE m.ring_id = r.id AND m.status = 'member' AND m.joined_at > now() - interval '7 days')
      + (SELECT count(*) FROM posts p WHERE p.board_id = r.board_id AND p.posted_at > now() - interval '7 days' AND p.deleted_at IS NULL AND p.hidden_at IS NULL) AS activity,
    (SELECT m.status FROM ring_members m WHERE m.ring_id = r.id AND m.user_id = $1) AS my_status
  FROM rings r JOIN users f ON f.id = r.founder_id LEFT JOIN boards b ON b.id = r.board_id`;

const isOp = (v: Viewer, ringId: string) => Boolean(v && (v.role === 'admin' || v.ops.includes(`ring:${ringId}`)));

function toSummary(v: Viewer, r: RingRow): RingSummary {
  return {
    id: r.id, slug: r.slug, name: r.name, description: r.description, tags: r.tags, join_policy: r.join_policy,
    founder: { id: r.founder_id, handle: r.founder_handle }, board: r.board_slug ? { slug: r.board_slug } : null,
    member_count: Number(r.member_count), archived: r.archived_at !== null, hidden: r.hidden_at !== null, created_at: r.created_at.toISOString(), recent_activity: Number(r.activity),
    me: v ? { status: r.my_status, is_op: isOp(v, r.id), is_founder: v.userId === r.founder_id } : null,
  };
}

// A hidden ring exists only for admins.
async function loadRing(q: Queryable, slug: string, v: Viewer): Promise<RingRow> {
  const r = await q.query<RingRow>(`${SUMMARY_SQL} WHERE r.slug = $2 AND (r.hidden_at IS NULL OR $3::boolean)`, [v?.userId ?? null, slug, v?.role === 'admin']);
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}
const needOp = (v: SessionUser, ring: RingRow) => {
  if (!isOp(v, ring.id)) throw new ApiError(403, 'forbidden', 'Only the ring’s ops and admins can do that.');
};
const needFounder = (v: SessionUser, ring: RingRow) => {
  if (v.role !== 'admin' && v.userId !== ring.founder_id) throw new ApiError(403, 'forbidden', 'Only the ring’s founder and admins can do that.');
};
const isMember = (v: SessionUser) => v.role !== 'guest';

// ---------------------------------------------------------------- founding and editing

export async function createRing(deps: AppDeps, v: SessionUser, input: { slug: string; name: string; description: string; about: string; tags: string[]; join_policy: JoinPolicy }, ctx: Ctx): Promise<RingSummary> {
  if (v.role !== 'trusted' && v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only trusted users can found rings.');
  const id = newId('r');
  const boardId = newId('b');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [v.userId]); // so two requests at once cannot both pass the quota
      if (v.role !== 'admin') {
        const n = await q.query<{ n: string }>(`SELECT count(*) AS n FROM rings WHERE founder_id = $1 AND archived_at IS NULL`, [v.userId]);
        const quota = deps.config.limits.trusted_ring_quota;
        if (Number(n.rows[0]!.n) >= quota) throw new ApiError(409, 'quota_reached', `You can found ${quota} rings. Archive one or ask an admin.`);
      }
      await q.query(`INSERT INTO rings (id, slug, name, description, about, tags, founder_id, join_policy) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, input.slug, input.name, input.description, input.about, input.tags, v.userId, input.join_policy]);
      // Every ring has exactly one board, made with it. Public to read, and only members post.
      await q.query(`INSERT INTO boards (id, slug, name, description, owner_id, visibility, ring_id) VALUES ($1, $2, $3, $4, $5, 'ring', $6)`,
        [boardId, `ring-${input.slug}`, input.name, input.description, v.userId, id]);
      await q.query(`UPDATE rings SET board_id = $2 WHERE id = $1`, [id, boardId]);
      await q.query(`INSERT INTO ring_members (ring_id, user_id, status, position) VALUES ($1, $2, 'member', 1)`, [id, v.userId]);
      // The founder is the first op.
      const opId = newId('o');
      await q.query(`INSERT INTO scoped_roles (id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1, $2, 'ring_op', 'ring', $3, $2)`, [opId, v.userId, id]);
      await finishOpsChange(q, v, v.userId, 'granted', `ring:${id}`, 'founded the ring', ctx, opId);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'ring.created', targetType: 'ring', targetId: id, after: { slug: input.slug, join_policy: input.join_policy }, origin: 'web', ipHash: ctx.ipHash });
      await emit(q, 'ring.created', { ring_id: id, slug: input.slug, founder_id: v.userId });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'slug_taken', 'That address is taken. Try another.');
    throw err;
  }
  // The session's op list is read fresh on each request, so the new ring is already theirs.
  return getRingSummary(deps, { ...v, ops: await opsFor(deps.db, v.userId) }, input.slug);
}

export async function getRingSummary(deps: AppDeps, v: Viewer, slug: string): Promise<RingSummary> {
  return toSummary(v, await loadRing(deps.db, slug, v));
}

export async function getRing(deps: AppDeps, v: Viewer, slug: string): Promise<RingDetail> {
  const r = await loadRing(deps.db, slug, v);
  const [ops, latest] = await Promise.all([
    deps.db.query<{ op_id: string; id: string; handle: string }>(`SELECT s.id AS op_id, u.id, u.handle FROM scoped_roles s JOIN users u ON u.id = s.user_id WHERE s.scope_type = 'ring' AND s.scope_id = $1 ORDER BY u.handle`, [r.id]),
    deps.db.query<{ id: string; thread_id: string; subject: string; handle: string | null; posted_at: Date }>(
      `SELECT p.id, COALESCE(p.thread_root_id, p.id) AS thread_id, p.subject, u.handle, p.posted_at FROM posts p LEFT JOIN users u ON u.id = p.author_id
       WHERE p.board_id = $1 AND p.deleted_at IS NULL AND p.hidden_at IS NULL ORDER BY p.seq DESC LIMIT 5`, [r.board_id]),
  ]);
  return { ...toSummary(v, r), about: r.about, ops: ops.rows,
    latest_posts: latest.rows.map((p) => ({ id: p.id, thread_id: p.thread_id, subject: p.subject, author: p.handle, at: p.posted_at.toISOString() })) };
}

export async function listRings(deps: AppDeps, v: Viewer, opts: { tag?: string; q?: string; sort?: 'newest' | 'active' | 'name'; limit?: number; offset?: number }): Promise<{ rings: RingSummary[]; next: number | null }> {
  const limit = Math.min(opts.limit ?? 24, 60);
  const offset = opts.offset ?? 0;
  const like = opts.q ? `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const order = opts.sort === 'active' ? 'activity DESC, r.created_at DESC' : opts.sort === 'name' ? 'lower(r.name)' : 'r.created_at DESC';
  const r = await deps.db.query<RingRow>(
    `${SUMMARY_SQL} WHERE r.hidden_at IS NULL AND ($2::text IS NULL OR $2 = ANY(r.tags))
       AND ($3::text IS NULL OR r.name ILIKE $3 ESCAPE '\\' OR r.description ILIKE $3 ESCAPE '\\')
     ORDER BY ${order} OFFSET $4 LIMIT $5`, [v?.userId ?? null, opts.tag ?? null, like, offset, limit + 1]);
  return { rings: r.rows.slice(0, limit).map((x) => toSummary(v, x)), next: r.rows.length > limit ? offset + limit : null };
}

export async function randomRing(deps: AppDeps): Promise<{ slug: string } | null> {
  const r = await deps.db.query<{ slug: string }>(`SELECT slug FROM rings WHERE hidden_at IS NULL AND archived_at IS NULL ORDER BY random() LIMIT 1`);
  return r.rows[0] ?? null;
}

export async function updateRing(
  deps: AppDeps, v: SessionUser, slug: string,
  patch: { name?: string; description?: string; about?: string; tags?: string[]; join_policy?: JoinPolicy; archived?: boolean }, ctx: Ctx,
): Promise<RingSummary> {
  await deps.db.tx(async (q) => {
    const ring = await loadRing(q, slug, v);
    needOp(v, ring);
    await q.query(`SELECT 1 FROM rings WHERE id = $1 FOR UPDATE`, [ring.id]);
    const after = {
      name: patch.name ?? ring.name, description: patch.description ?? ring.description, about: patch.about ?? ring.about,
      tags: patch.tags ?? ring.tags, join_policy: patch.join_policy ?? ring.join_policy, archived: patch.archived ?? ring.archived_at !== null,
    };
    await q.query(`UPDATE rings SET name = $2, description = $3, about = $4, tags = $5, join_policy = $6, archived_at = CASE WHEN $7::boolean THEN COALESCE(archived_at, now()) ELSE NULL END WHERE id = $1`,
      [ring.id, after.name, after.description, after.about, after.tags, after.join_policy, after.archived]);
    // The ring's board follows the ring: archived together, and named the same.
    await q.query(`UPDATE boards SET name = $2, description = $3, archived_at = CASE WHEN $4::boolean THEN COALESCE(archived_at, now()) ELSE NULL END WHERE id = $1`, [ring.board_id, after.name, after.description, after.archived]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'ring.updated', targetType: 'ring', targetId: ring.id,
      before: { name: ring.name, description: ring.description, tags: ring.tags, join_policy: ring.join_policy, archived: ring.archived_at !== null }, after, origin: 'web', ipHash: ctx.ipHash });
  });
  return getRingSummary(deps, v, slug);
}

// ---------------------------------------------------------------- joining and leaving

const nextPosition = async (q: Queryable, ringId: string): Promise<number> =>
  Number((await q.query<{ p: string | null }>(`SELECT max(position) AS p FROM ring_members WHERE ring_id = $1`, [ringId])).rows[0]!.p ?? 0) + 1;

async function setStatus(q: Queryable, ring: RingRow, userId: string, status: MemberStatus): Promise<void> {
  await q.query(
    `INSERT INTO ring_members (ring_id, user_id, status, position) VALUES ($1, $2, $3, $4)
     ON CONFLICT (ring_id, user_id) DO UPDATE SET status = EXCLUDED.status, joined_at = CASE WHEN ring_members.status <> EXCLUDED.status THEN now() ELSE ring_members.joined_at END`,
    [ring.id, userId, status, await nextPosition(q, ring.id)]);
  await emit(q, 'ring.member_changed', { ring_id: ring.id, user_id: userId, status });
}

export async function join(deps: AppDeps, v: SessionUser, slug: string, ctx: Ctx): Promise<{ status: MemberStatus }> {
  if (!isMember(v)) throw new ApiError(403, 'email_not_verified', 'Confirm your email address to join a ring.');
  return deps.db.tx(async (q) => {
    const ring = await loadRing(q, slug, v);
    if (ring.archived_at) throw new ApiError(409, 'archived', 'This ring is archived. It is not taking members.');
    await q.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [v.userId]); // one join at a time per person, for the cap below
    const have = ring.my_status;
    if (have === 'banned') throw new ApiError(403, 'banned', 'You cannot join this ring.');
    if (have === 'member') throw new ApiError(409, 'no_change', 'You are already in this ring.');
    if (have === 'pending') throw new ApiError(409, 'no_change', 'You already asked to join. The ring’s ops will get to it.');
    const count = await q.query<{ n: string }>(`SELECT count(*) AS n FROM ring_members WHERE user_id = $1 AND status = 'member'`, [v.userId]);
    if (Number(count.rows[0]!.n) >= MAX_RING_MEMBERSHIPS) throw new ApiError(409, 'too_many_rings', `You can be in up to ${MAX_RING_MEMBERSHIPS} rings. Leave one first.`);
    let status: MemberStatus;
    if (have === 'invited') status = 'member';           // accepting an invitation
    else if (ring.join_policy === 'open') status = 'member';
    else if (ring.join_policy === 'approval') status = 'pending';
    else throw new ApiError(403, 'invite_only', 'This ring is by invitation only.');
    await setStatus(q, ring, v.userId, status);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: `ring.${status === 'member' ? 'joined' : 'join_requested'}`, targetType: 'ring', targetId: ring.id, origin: 'web', ipHash: ctx.ipHash });
    return { status };
  });
}

export async function leave(deps: AppDeps, v: SessionUser, slug: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const ring = await loadRing(q, slug, v);
    if (ring.founder_id === v.userId) throw new ApiError(409, 'founder', 'The founder cannot leave. Hand the ring to another op first, or archive it.');
    if (ring.my_status === 'banned') throw new ApiError(403, 'banned', 'You cannot change that.');
    const del = await q.query(`DELETE FROM ring_members WHERE ring_id = $1 AND user_id = $2`, [ring.id, v.userId]);
    if (del.rowCount === 0) throw new ApiError(409, 'no_change', 'You are not in this ring.');
    await emit(q, 'ring.member_changed', { ring_id: ring.id, user_id: v.userId, status: 'removed' });
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'ring.left', targetType: 'ring', targetId: ring.id, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function invite(deps: AppDeps, v: SessionUser, slug: string, handle: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const ring = await loadRing(q, slug, v);
    needOp(v, ring);
    if (ring.archived_at) throw new ApiError(409, 'archived', 'This ring is archived.');
    const u = await q.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1) AND status = 'active' AND role <> 'guest'`, [handle]);
    if (!u.rows[0]) throw new ApiError(404, 'not_found', 'No user has that handle.');
    const existing = (await q.query<{ status: MemberStatus }>(`SELECT status FROM ring_members WHERE ring_id = $1 AND user_id = $2`, [ring.id, u.rows[0].id])).rows[0]?.status;
    if (existing === 'banned') throw new ApiError(409, 'banned', 'That person is banned from this ring. Lift the ban first.');
    if (existing === 'member' || existing === 'invited') throw new ApiError(409, 'no_change', 'They are already in, or invited.');
    // Someone who had asked to join is simply let in.
    await setStatus(q, ring, u.rows[0].id, existing === 'pending' ? 'member' : 'invited');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'ring.invited', targetType: 'ring', targetId: ring.id, after: { user_id: u.rows[0].id }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function memberAction(deps: AppDeps, v: SessionUser, slug: string, userId: string, action: 'approve' | 'remove' | 'ban' | 'unban', reason: string | undefined, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const ring = await loadRing(q, slug, v);
    needOp(v, ring);
    const row = await q.query<{ status: MemberStatus }>(`SELECT status FROM ring_members WHERE ring_id = $1 AND user_id = $2 FOR UPDATE`, [ring.id, userId]);
    const status = row.rows[0]?.status;
    if (!status && action !== 'ban') throw new ApiError(404, 'not_found', 'That person has nothing to do with this ring.');
    if (userId === ring.founder_id) throw new ApiError(409, 'founder', 'The founder cannot be removed or banned. Hand the ring on first.');
    if (['ban', 'remove'].includes(action) && !reason) throw new ApiError(400, 'reason_required', 'Give a reason. It goes in the audit log.');
    if (action === 'approve') {
      if (status !== 'pending') throw new ApiError(409, 'no_change', 'That person is not waiting for approval.');
      await setStatus(q, ring, userId, 'member');
    } else if (action === 'remove') {
      if (status === 'banned') throw new ApiError(409, 'banned', 'That person is banned. Lift the ban to let them back.');
      await q.query(`DELETE FROM ring_members WHERE ring_id = $1 AND user_id = $2`, [ring.id, userId]);
      await emit(q, 'ring.member_changed', { ring_id: ring.id, user_id: userId, status: 'removed' });
    } else if (action === 'ban') {
      if (status === 'banned') throw new ApiError(409, 'no_change', 'That person is already banned.');
      const target = await q.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
      if (target.rowCount === 0) throw new ApiError(404, 'not_found', 'No such user.');
      await setStatus(q, ring, userId, 'banned');
      await q.query(`INSERT INTO ring_bans (ring_id, user_id, reason, by_id) VALUES ($1, $2, $3, $4)`, [ring.id, userId, reason, v.userId]);
    } else {
      if (status !== 'banned') throw new ApiError(409, 'no_change', 'That person is not banned.');
      await q.query(`DELETE FROM ring_members WHERE ring_id = $1 AND user_id = $2`, [ring.id, userId]);
      await emit(q, 'ring.member_changed', { ring_id: ring.id, user_id: userId, status: 'removed' });
    }
    await audit(q, { actorId: v.userId, actorKind: 'user', action: `ring.member_${action}${action === 'approve' ? 'd' : action === 'ban' ? 'ned' : action === 'unban' ? 'ned' : 'd'}`, targetType: 'ring', targetId: ring.id, after: { user_id: userId, reason: reason ?? null }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// The order of the nav bar. People not listed keep their place after those who are.
export async function reorder(deps: AppDeps, v: SessionUser, slug: string, userIds: string[]): Promise<void> {
  await deps.db.tx(async (q) => {
    const ring = await loadRing(q, slug, v);
    needOp(v, ring);
    const cur = (await q.query<{ user_id: string }>(`SELECT user_id FROM ring_members WHERE ring_id = $1 AND status = 'member' ORDER BY position, user_id FOR UPDATE`, [ring.id])).rows.map((x) => x.user_id);
    const chosen = userIds.filter((id, i) => cur.includes(id) && userIds.indexOf(id) === i);
    const order = [...chosen, ...cur.filter((id) => !chosen.includes(id))];
    for (let i = 0; i < order.length; i++) await q.query(`UPDATE ring_members SET position = $3 WHERE ring_id = $1 AND user_id = $2`, [ring.id, order[i], i + 1]);
  });
}

// ---------------------------------------------------------------- ops and hand-over

export async function addOp(deps: AppDeps, v: SessionUser, slug: string, handle: string, reason: string | undefined, ctx: Ctx): Promise<void> {
  const ring = await loadRing(deps.db, slug, v);
  needFounder(v, ring);
  const u = await deps.db.query<{ id: string }>(`SELECT u.id FROM users u JOIN ring_members m ON m.user_id = u.id AND m.ring_id = $2 AND m.status = 'member' WHERE lower(u.handle) = lower($1) AND u.status = 'active'`, [handle, ring.id]);
  if (!u.rows[0]) throw new ApiError(404, 'not_found', 'Only members of the ring can be made ops.');
  await admin.grantOp(deps, v, u.rows[0].id, 'ring', ring.id, reason, ctx);
}

export async function removeOp(deps: AppDeps, v: SessionUser, slug: string, opId: string, ctx: Ctx): Promise<void> {
  const ring = await loadRing(deps.db, slug, v);
  const r = await deps.db.query<{ user_id: string }>(`SELECT user_id FROM scoped_roles WHERE id = $1 AND scope_type = 'ring' AND scope_id = $2`, [opId, ring.id]);
  const op = r.rows[0];
  if (!op) throw new ApiError(404, 'not_found', 'No such op on this ring.');
  if (op.user_id === ring.founder_id) throw new ApiError(409, 'founder', 'The founder stays an op. Hand the ring to someone else first.');
  if (v.role !== 'admin' && v.userId !== ring.founder_id && v.userId !== op.user_id) throw new ApiError(403, 'forbidden', 'Only the founder and admins can remove ops.');
  await admin.revokeOp(deps, v, op.user_id, opId, undefined, ctx);
}

// The founder hands the ring on. The new founder must be a trusted member (the quota applies to them).
export async function transfer(deps: AppDeps, v: SessionUser, slug: string, handle: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const ring = await loadRing(q, slug, v);
    needFounder(v, ring);
    const u = await q.query<{ id: string; role: string }>(
      `SELECT u.id, u.role FROM users u JOIN ring_members m ON m.user_id = u.id AND m.ring_id = $2 AND m.status = 'member' WHERE lower(u.handle) = lower($1) AND u.status = 'active'`, [handle, ring.id]);
    const to = u.rows[0];
    if (!to) throw new ApiError(404, 'not_found', 'Only members of the ring can take it over.');
    if (to.id === ring.founder_id) throw new ApiError(409, 'no_change', 'They are the founder already.');
    if (to.role !== 'trusted' && to.role !== 'admin') throw new ApiError(409, 'not_trusted', 'Only a trusted user can take over a ring.');
    if (to.role !== 'admin') {
      const n = await q.query<{ n: string }>(`SELECT count(*) AS n FROM rings WHERE founder_id = $1 AND archived_at IS NULL`, [to.id]);
      if (Number(n.rows[0]!.n) >= deps.config.limits.trusted_ring_quota) throw new ApiError(409, 'quota_reached', 'They already run as many rings as they are allowed.');
    }
    await q.query(`UPDATE rings SET founder_id = $2 WHERE id = $1`, [ring.id, to.id]);
    await q.query(`UPDATE boards SET owner_id = $2 WHERE id = $1`, [ring.board_id, to.id]);
    const has = await q.query(`SELECT 1 FROM scoped_roles WHERE user_id = $1 AND scope_type = 'ring' AND scope_id = $2`, [to.id, ring.id]);
    if (has.rowCount === 0) {
      const opId = newId('o');
      await q.query(`INSERT INTO scoped_roles (id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1, $2, 'ring_op', 'ring', $3, $4)`, [opId, to.id, ring.id, v.userId]);
      await finishOpsChange(q, v, to.id, 'granted', `ring:${ring.id}`, 'took over the ring', ctx, opId);
    }
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'ring.transferred', targetType: 'ring', targetId: ring.id, before: { founder_id: ring.founder_id }, after: { founder_id: to.id }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// ---------------------------------------------------------------- members list and the nav bar

export async function listMembers(deps: AppDeps, v: Viewer, slug: string, opts: { status?: MemberStatus; offset?: number; limit?: number }): Promise<{ members: RingMemberView[]; next: number | null }> {
  const ring = await loadRing(deps.db, slug, v);
  const ops = isOp(v, ring.id);
  // Everyone sees who is in. Ops also see who is waiting, invited or banned, and how their pages are doing.
  const status = ops ? opts.status ?? 'member' : 'member';
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const r = await deps.db.query<{ user_id: string; handle: string; display_name: string | null; status: MemberStatus; joined_at: Date; nav_detected_at: Date | null; has_index: boolean | null; hidden_at: Date | null }>(
    `SELECT m.user_id, u.handle, u.display_name, m.status, m.joined_at, m.nav_detected_at, h.has_index, h.hidden_at
     FROM ring_members m JOIN users u ON u.id = m.user_id LEFT JOIN homepages h ON h.user_id = u.id
     WHERE m.ring_id = $1 AND m.status = $2 AND u.status = 'active' ORDER BY m.position, m.user_id OFFSET $3 LIMIT $4`, [ring.id, status, offset, limit + 1]);
  const now = deps.now();
  const members = r.rows.slice(0, limit).map((m): RingMemberView => {
    const live = Boolean(m.has_index) && m.hidden_at === null;
    const view: RingMemberView = { user_id: m.user_id, handle: m.handle, display_name: m.display_name, status: m.status, joined_at: m.joined_at.toISOString(), homepage_url: live ? deps.homesUrl(m.handle) : null };
    if (ops && m.status === 'member') {
      view.flags = [];
      if (!live) view.flags.push('no_homepage');
      else if (!m.nav_detected_at || now - m.nav_detected_at.getTime() > NAV_SEEN_DAYS * 86_400_000) view.flags.push('no_nav_bar');
    }
    return view;
  });
  return { members, next: r.rows.length > limit ? offset + limit : null };
}

// Members whose pages a visitor can be sent to.
async function navigable(q: Queryable, ringId: string): Promise<{ user_id: string; handle: string }[]> {
  return (await q.query<{ user_id: string; handle: string }>(
    `SELECT m.user_id, u.handle FROM ring_members m JOIN users u ON u.id = m.user_id JOIN homepages h ON h.user_id = u.id
     WHERE m.ring_id = $1 AND m.status = 'member' AND u.status = 'active' AND h.has_index AND h.hidden_at IS NULL ORDER BY m.position, m.user_id`, [ringId])).rows;
}

// Where prev, next and random lead. A person who is no longer in the ring still gets somewhere.
export async function navTarget(deps: AppDeps, slug: string, dir: 'next' | 'prev' | 'random', from: string | undefined): Promise<string> {
  const ring = (await deps.db.query<{ id: string }>(`SELECT id FROM rings WHERE slug = $1 AND hidden_at IS NULL`, [slug])).rows[0];
  if (!ring) return `${deps.publicUrl}/rings`;
  const list = await navigable(deps.db, ring.id);
  if (list.length === 0) return `${deps.publicUrl}/rings/${slug}`;
  const at = list.findIndex((m) => m.user_id === from);
  let pick: { handle: string };
  if (dir === 'random') {
    const others = list.filter((m) => m.user_id !== from);
    pick = (others.length ? others : list)[Math.floor(Math.random() * (others.length || list.length))]!;
  } else if (at === -1) {
    pick = dir === 'next' ? list[0]! : list[list.length - 1]!;
  } else {
    pick = list[(at + (dir === 'next' ? 1 : list.length - 1)) % list.length]!;
  }
  return deps.homesUrl(pick.handle);
}

// What the nav script needs. It also notes that the bar is running on a member's page, when the
// request comes from that page's own address (a browser says so in `Origin`).
export async function navInfo(deps: AppDeps, slug: string, member: string | undefined, origin: string | undefined): Promise<RingNav> {
  const ring = (await deps.db.query<{ id: string; name: string }>(`SELECT id, name FROM rings WHERE slug = $1 AND hidden_at IS NULL`, [slug])).rows[0];
  if (!ring) throw notFound();
  const isMemberNow = member ? (await deps.db.query(`SELECT 1 FROM ring_members WHERE ring_id = $1 AND user_id = $2 AND status = 'member'`, [ring.id, member])).rowCount > 0 : false;
  if (isMemberNow && origin) {
    const h = (await deps.db.query<{ handle: string }>(`SELECT handle FROM users WHERE id = $1`, [member]))?.rows[0];
    let host = '';
    try { host = new URL(origin).hostname; } catch { /* not a web address */ }
    // The member's own page: their homepage address, or a custom domain they have verified.
    const own = h && (new URL(deps.homesUrl(h.handle)).hostname === host ||
      (await deps.db.query(`SELECT 1 FROM custom_domains WHERE user_id = $1 AND domain = $2 AND status = 'verified'`, [member, host])).rowCount > 0);
    if (own) {
      await deps.db.query(`UPDATE ring_members SET nav_detected_at = now() WHERE ring_id = $1 AND user_id = $2`, [ring.id, member]);
    }
  }
  const link = (what: string) => `${deps.publicUrl}/ring/${slug}/${what}${member ? `?from=${encodeURIComponent(member)}` : ''}`;
  return { ring: { slug, name: ring.name, url: `${deps.publicUrl}/rings/${slug}` }, member: isMemberNow, prev: link('prev'), next: link('next'), random: link('random'), list: link('list') };
}

// The snippet a member pastes into their page: the script, and plain links for visitors without scripts.
export function navSnippet(deps: AppDeps, slug: string, userId: string, style: 'bar' | 'buttons' | 'banner' = 'bar'): string {
  const from = encodeURIComponent(userId);
  const base = `${deps.publicUrl}/ring/${slug}`;
  return `<script src="${base}/nav.js" data-member="${userId}" data-style="${style}"></script>\n` +
    `<noscript><p><a href="${base}/prev?from=${from}">Previous</a> | <a href="${base}/list?from=${from}">Ring</a> | <a href="${base}/random?from=${from}">Random</a> | <a href="${base}/next?from=${from}">Next</a></p></noscript>`;
}

// ---------------------------------------------------------------- admin

export async function setRingHidden(deps: AppDeps, adminUser: SessionUser, ringId: string, hidden: boolean, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ hidden_at: Date | null; board_id: string | null }>(`SELECT hidden_at, board_id FROM rings WHERE id = $1 FOR UPDATE`, [ringId]);
    if (!r.rows[0]) throw notFound();
    if ((r.rows[0].hidden_at !== null) === hidden) throw new ApiError(409, 'no_change', hidden ? 'That ring is already hidden.' : 'That ring is not hidden.');
    await q.query(`UPDATE rings SET hidden_at = ${hidden ? 'now()' : 'NULL'} WHERE id = $1`, [ringId]);
    await q.query(`UPDATE boards SET hidden_at = ${hidden ? 'now()' : 'NULL'} WHERE id = $1`, [r.rows[0].board_id]);
    await audit(q, { actorId: adminUser.userId, actorKind: 'user', action: hidden ? 'ring.hidden' : 'ring.restored', targetType: 'ring', targetId: ringId, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function adminListRings(deps: AppDeps, opts: { q?: string; before?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const like = opts.q ? `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const r = await deps.db.query<{ id: string; slug: string; name: string; founder: string; join_policy: JoinPolicy; members: string; archived_at: Date | null; hidden_at: Date | null; created_at: Date; board_slug: string | null }>(
    `SELECT r.id, r.slug, r.name, f.handle AS founder, r.join_policy, r.archived_at, r.hidden_at, r.created_at, b.slug AS board_slug,
            (SELECT count(*) FROM ring_members m WHERE m.ring_id = r.id AND m.status = 'member') AS members
     FROM rings r JOIN users f ON f.id = r.founder_id LEFT JOIN boards b ON b.id = r.board_id
     WHERE ($1::text IS NULL OR r.name ILIKE $1 ESCAPE '\\' OR r.slug ILIKE $1 ESCAPE '\\') AND ($2::text IS NULL OR r.id > $2) ORDER BY r.id LIMIT $3`, [like, opts.before ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  return {
    rings: page.map((x) => ({ id: x.id, slug: x.slug, name: x.name, founder: x.founder, join_policy: x.join_policy, members: Number(x.members), archived: x.archived_at !== null, hidden: x.hidden_at !== null, created_at: x.created_at.toISOString(), board: x.board_slug })),
    next: r.rows.length > limit ? page[page.length - 1]!.id : null,
  };
}
