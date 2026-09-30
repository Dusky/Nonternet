import { OP_ROLE, handleSchema, isReservedHandle, opClaim, type OpScope, type Role } from '@app/shared';
import { audit } from './audit';
import { newId } from './crypto';
import { isUniqueViolation, type Queryable } from './db';
import type { AppDeps } from './deps';
import { emit } from './events';
import { ApiError } from './errors';
import { opsFor, revokeAllSessions, type Ctx, type SessionUser } from './accounts';

interface Target { id: string; handle: string; role: Role; role_rev: number; status: string; email_verified_at: string | null }

const notFound = () => new ApiError(404, 'not_found', 'No such user.');

// Locks the row so two admins acting on the same user at once are applied one after the other.
async function lockTarget(q: Queryable, id: string): Promise<Target> {
  const r = await q.query<Target>(`SELECT id, handle, role, role_rev, status, email_verified_at FROM users WHERE id = $1 FOR UPDATE`, [id]);
  const t = r.rows[0];
  if (!t || t.status === 'deleted') throw notFound();
  return t;
}

// ---------------------------------------------------------------- roles

export async function setRole(deps: AppDeps, admin: SessionUser, targetId: string, role: Role, reason: string, ctx: Ctx): Promise<{ role: Role; role_rev: number }> {
  // An admin can't change their own role, so the site can never be left with no admin by accident.
  if (targetId === admin.userId) throw new ApiError(409, 'cannot_change_own_role', 'You cannot change your own role. Ask another admin.');
  return deps.db.tx(async (q) => {
    const t = await lockTarget(q, targetId);
    if (t.role === role) throw new ApiError(409, 'no_change', `${t.handle} already has that role.`);
    // Trusted and admin are earned standing; they need a confirmed email address first.
    if ((role === 'trusted' || role === 'admin') && !t.email_verified_at) {
      throw new ApiError(409, 'email_not_verified', 'This user has not confirmed their email address yet.');
    }
    const u = await q.query<{ role_rev: number }>(`UPDATE users SET role = $2, role_rev = role_rev + 1, updated_at = now() WHERE id = $1 RETURNING role_rev`, [targetId, role]);
    const roleRev = u.rows[0]!.role_rev;
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'user.role_changed', targetType: 'user', targetId,
      before: { role: t.role }, after: { role, reason }, origin: 'web', ipHash: ctx.ipHash });
    await emit(q, 'user.role_changed', { user_id: targetId, role, previous_role: t.role, role_rev: roleRev });
    return { role, role_rev: roleRev };
  });
}

// ---------------------------------------------------------------- handle

// Changing a handle (docs/02, docs/07). Everything a person owns is keyed by their ID, so nothing else moves.
// The old handle is kept for 90 days: their homepage address redirects, and nobody else can take it.
export async function renameUser(deps: AppDeps, admin: SessionUser, targetId: string, newHandle: string, reason: string, ctx: Ctx): Promise<{ handle: string; role_rev: number }> {
  const parsed = handleSchema.safeParse(newHandle);
  if (!parsed.success) throw new ApiError(400, 'invalid_handle', parsed.error.issues[0]!.message);
  if (isReservedHandle(newHandle, deps.config.site.short_name)) throw new ApiError(409, 'handle_unavailable', 'That handle is not available.');
  return deps.db.tx(async (q) => {
    const t = await lockTarget(q, targetId);
    if (t.handle === newHandle) throw new ApiError(409, 'no_change', 'That is already their handle.');
    const caseOnly = t.handle.toLowerCase() === newHandle.toLowerCase();
    if (!caseOnly) {
      const held = await q.query(`SELECT 1 FROM handle_history WHERE handle = lower($1) AND user_id <> $2 AND changed_at > now() - interval '90 days'`, [newHandle, targetId]);
      if (held.rowCount > 0) throw new ApiError(409, 'handle_unavailable', 'Someone gave that handle up recently, so it is held for them.');
    }
    try {
      await q.query(`UPDATE users SET handle = $2, updated_at = now() WHERE id = $1`, [targetId, newHandle]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, 'handle_unavailable', 'That handle is taken.');
      throw err;
    }
    if (!caseOnly) await q.query(`INSERT INTO handle_history (user_id, handle) VALUES ($1, lower($2))`, [targetId, t.handle]);
    // Services cache the handle claim, so the role revision goes up like any other identity change.
    const u = await q.query<{ role_rev: number }>(`UPDATE users SET role_rev = role_rev + 1 WHERE id = $1 RETURNING role_rev`, [targetId]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'user.renamed', targetType: 'user', targetId, before: { handle: t.handle }, after: { handle: newHandle, reason }, origin: 'web', ipHash: ctx.ipHash });
    await emit(q, 'user.renamed', { user_id: targetId, handle: newHandle, previous_handle: t.handle, role_rev: u.rows[0]!.role_rev });
    return { handle: newHandle, role_rev: u.rows[0]!.role_rev };
  });
}

// ---------------------------------------------------------------- suspension

export async function suspend(deps: AppDeps, admin: SessionUser, targetId: string, reason: string, ctx: Ctx): Promise<void> {
  if (targetId === admin.userId) throw new ApiError(409, 'cannot_suspend_self', 'You cannot suspend yourself.');
  await deps.db.tx(async (q) => {
    const t = await lockTarget(q, targetId);
    if (t.status !== 'active') throw new ApiError(409, 'no_change', `${t.handle} is already suspended.`);
    await q.query(`UPDATE users SET status = 'suspended', updated_at = now() WHERE id = $1`, [targetId]);
    await revokeAllSessions(q, targetId, 'suspended');
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'user.suspended', targetType: 'user', targetId,
      before: { status: 'active' }, after: { status: 'suspended', reason }, origin: 'web', ipHash: ctx.ipHash });
    await emit(q, 'user.suspended', { user_id: targetId });
  });
}

export async function unsuspend(deps: AppDeps, admin: SessionUser, targetId: string, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const t = await lockTarget(q, targetId);
    if (t.status !== 'suspended') throw new ApiError(409, 'no_change', `${t.handle} is not suspended.`);
    await q.query(`UPDATE users SET status = 'active', updated_at = now() WHERE id = $1`, [targetId]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'user.unsuspended', targetType: 'user', targetId,
      before: { status: 'suspended' }, after: { status: 'active', reason }, origin: 'web', ipHash: ctx.ipHash });
    await emit(q, 'user.unsuspended', { user_id: targetId });
  });
}

// ---------------------------------------------------------------- ops

export interface OpRow { id: string; scope: OpScope; scope_id: string; granted_by: string; created_at: string }

export async function listOps(deps: AppDeps, targetId: string): Promise<{ ops: OpRow[]; claims: string[] }> {
  const t = await deps.db.query(`SELECT 1 FROM users WHERE id = $1 AND status <> 'deleted'`, [targetId]);
  if (t.rowCount === 0) throw notFound();
  const r = await deps.db.query<{ id: string; scope_type: OpScope; scope_id: string; granted_by: string; created_at: string }>(
    `SELECT id, scope_type, scope_id, granted_by, created_at FROM scoped_roles WHERE user_id = $1 ORDER BY scope_type, scope_id`, [targetId]);
  return {
    ops: r.rows.map((o) => ({ id: o.id, scope: o.scope_type, scope_id: o.scope_id, granted_by: o.granted_by, created_at: new Date(o.created_at).toISOString() })),
    claims: await opsFor(deps.db, targetId),
  };
}

// Any user can be an op, not only trusted ones (docs/03). Only admins grant ops for now; ring
// founders and board owners get their own paths when rings and boards exist.
// Boards and rings must exist. Channels arrive with IRC (M5) and are only checked for shape until then.
export async function grantOp(deps: AppDeps, admin: SessionUser, targetId: string, scope: OpScope, scopeId: string, reason: string | undefined, ctx: Ctx): Promise<{ id: string; ops: string[]; role_rev: number }> {
  return deps.db.tx(async (q) => {
    const t = await lockTarget(q, targetId);
    if (scope === 'board' && (await q.query(`SELECT 1 FROM boards WHERE id = $1`, [scopeId])).rowCount === 0) throw new ApiError(404, 'not_found', 'No such board.');
    if (scope === 'ring' && (await q.query(`SELECT 1 FROM rings WHERE id = $1`, [scopeId])).rowCount === 0) throw new ApiError(404, 'not_found', 'No such ring.');
    if (t.status !== 'active') throw new ApiError(409, 'user_not_active', `${t.handle} is suspended.`);
    const id = newId('o');
    try {
      await q.query(`INSERT INTO scoped_roles (id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, targetId, OP_ROLE[scope], scope, scopeId, admin.userId]);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiError(409, 'already_op', `${t.handle} is already an op there.`);
      throw err;
    }
    return finishOpsChange(q, admin, targetId, 'granted', opClaim(scope, scopeId), reason, ctx, id);
  });
}

export async function revokeOp(deps: AppDeps, admin: SessionUser, targetId: string, opId: string, reason: string | undefined, ctx: Ctx): Promise<{ ops: string[]; role_rev: number }> {
  return deps.db.tx(async (q) => {
    await lockTarget(q, targetId);
    const r = await q.query<{ scope_type: OpScope; scope_id: string }>(`DELETE FROM scoped_roles WHERE id = $1 AND user_id = $2 RETURNING scope_type, scope_id`, [opId, targetId]);
    const gone = r.rows[0];
    if (!gone) throw new ApiError(404, 'not_found', 'No such op for this user.');
    const out = await finishOpsChange(q, admin, targetId, 'revoked', opClaim(gone.scope_type, gone.scope_id), reason, ctx);
    return { ops: out.ops, role_rev: out.role_rev };
  });
}

// role_rev goes up on any role or ops change (docs/02), so services can tell a stale claim from a fresh one.
export async function finishOpsChange(q: Queryable, admin: SessionUser, targetId: string, change: 'granted' | 'revoked', claim: string, reason: string | undefined, ctx: Ctx, id = ''): Promise<{ id: string; ops: string[]; role_rev: number }> {
  const u = await q.query<{ role_rev: number }>(`UPDATE users SET role_rev = role_rev + 1, updated_at = now() WHERE id = $1 RETURNING role_rev`, [targetId]);
  const roleRev = u.rows[0]!.role_rev;
  const ops = await opsFor(q, targetId);
  await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'user.ops_changed', targetType: 'user', targetId,
    after: { [change]: claim, reason: reason ?? null, ops }, origin: 'web', ipHash: ctx.ipHash });
  await emit(q, 'user.ops_changed', { user_id: targetId, ops, role_rev: roleRev });
  return { id, ops, role_rev: roleRev };
}

// ---------------------------------------------------------------- audit log (read side)

export interface AuditFilter {
  actor?: string; targetType?: string; targetId?: string; action?: string; origin?: string;
  from?: string; to?: string; before?: number; limit?: number;
}

export async function listAudit(deps: AppDeps, f: AuditFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.actor) add('a.actor_id = ?', f.actor);
  if (f.targetType) add('a.target_type = ?', f.targetType);
  if (f.targetId) add('a.target_id = ?', f.targetId);
  // "user.role_changed" matches exactly; "user.*" matches the family.
  if (f.action) f.action.endsWith('.*') ? add('starts_with(a.action, ?)', f.action.slice(0, -1)) : add('a.action = ?', f.action);
  if (f.origin) add('a.origin = ?', f.origin);
  if (f.from) add('a.created_at >= ?', f.from);
  if (f.to) add('a.created_at < ?', f.to);
  if (f.before) add('a.id < ?', f.before);
  const limit = Math.min(f.limit ?? 50, 200);
  params.push(limit + 1);
  const r = await deps.db.query<{
    id: string; created_at: Date; actor_id: string | null; actor_handle: string | null; actor_kind: string; action: string;
    target_type: string | null; target_id: string | null; before: unknown; after: unknown; origin: string;
  }>(
    `SELECT a.id, a.created_at, a.actor_id, u.handle AS actor_handle, a.actor_kind, a.action, a.target_type, a.target_id, a.before, a.after, a.origin
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.id DESC LIMIT $${params.length}`, params);
  const page = r.rows.slice(0, limit);
  return {
    entries: page.map((e) => ({
      id: Number(e.id), at: new Date(e.created_at).toISOString(), actor_id: e.actor_id, actor_handle: e.actor_handle, actor_kind: e.actor_kind,
      action: e.action, target_type: e.target_type, target_id: e.target_id, before: e.before, after: e.after, origin: e.origin,
    })),
    // Pass this back as ?before= for the next page. null when there are no more.
    next_before: r.rows.length > limit ? Number(page[page.length - 1]!.id) : null,
  };
}

// ---------------------------------------------------------------- users and invites (read side)

export interface UserFilter { q?: string; role?: Role; status?: 'active' | 'suspended' | 'deleted'; before?: string; limit?: number }

// Escape LIKE wildcards so "_" and "%" in a search are searched for, not treated as patterns.
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Newest first. IDs are ULIDs, so id order is signup order and `before` pages without gaps.
export async function listUsers(deps: AppDeps, f: UserFilter) {
  const where: string[] = [`status <> 'deleted' OR $1::boolean`];
  const params: unknown[] = [f.status === 'deleted'];
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.q) { const like = `%${likeEscape(f.q.toLowerCase())}%`; params.push(like); where.push(`(lower(handle) LIKE $${params.length} OR lower(email) LIKE $${params.length} OR lower(coalesce(display_name, '')) LIKE $${params.length})`); }
  if (f.role) add('role = ?', f.role);
  if (f.status) add('status = ?', f.status);
  if (f.before) add('id < ?', f.before);
  const limit = Math.min(f.limit ?? 50, 200);
  params.push(limit + 1);
  const r = await deps.db.query<{
    id: string; handle: string; display_name: string | null; email: string; role: Role; role_rev: number; status: string;
    email_verified_at: Date | null; totp_enabled_at: Date | null; created_at: Date; last_seen_at: Date | null;
  }>(
    `SELECT id, handle, display_name, email, role, role_rev, status, email_verified_at, totp_enabled_at, created_at, last_seen_at
       FROM users WHERE ${where.map((w) => `(${w})`).join(' AND ')} ORDER BY id DESC LIMIT $${params.length}`, params);
  const page = r.rows.slice(0, limit);
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    users: page.map((u) => ({
      id: u.id, handle: u.handle, display_name: u.display_name, email: u.email, role: u.role, role_rev: u.role_rev, status: u.status,
      email_verified: !!u.email_verified_at, totp_enabled: !!u.totp_enabled_at, created_at: iso(u.created_at), last_seen_at: iso(u.last_seen_at),
    })),
    next_before: r.rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

// The basic dossier (docs/11): who they are, how they got in, what they can do, and what happened to them.
export async function getDossier(deps: AppDeps, id: string) {
  const u = await deps.db.query<{
    id: string; handle: string; display_name: string | null; bio: string | null; email: string; role: Role; role_rev: number; status: string;
    email_verified_at: Date | null; totp_enabled_at: Date | null; theme: string | null; created_at: Date; last_seen_at: Date | null;
  }>(`SELECT id, handle, display_name, bio, email, role, role_rev, status, email_verified_at, totp_enabled_at, theme, created_at, last_seen_at FROM users WHERE id = $1`, [id]);
  const user = u.rows[0];
  if (!user) throw notFound();
  const [ops, invite, sessions, recovery, history] = await Promise.all([
    listOps(deps, id).catch(() => ({ ops: [], claims: [] })),
    deps.db.query<{ code: string; created_by_handle: string | null }>(`SELECT i.code, c.handle AS created_by_handle FROM invites i LEFT JOIN users c ON c.id = i.created_by WHERE i.used_by = $1`, [id]),
    deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`, [id]),
    deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [id]),
    listAudit(deps, { targetType: 'user', targetId: id, limit: 20 }),
  ]);
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return {
    user: {
      id: user.id, handle: user.handle, display_name: user.display_name, bio: user.bio, email: user.email, role: user.role, role_rev: user.role_rev,
      status: user.status, email_verified: !!user.email_verified_at, totp_enabled: !!user.totp_enabled_at, theme: user.theme,
      created_at: iso(user.created_at), last_seen_at: iso(user.last_seen_at),
    },
    ops: ops.ops,
    invite: invite.rows[0] ? { code: invite.rows[0].code, created_by: invite.rows[0].created_by_handle } : null,
    active_sessions: sessions.rows[0]!.n,
    recovery_codes_remaining: recovery.rows[0]!.n,
    history: history.entries,
  };
}

export async function listInvites(deps: AppDeps, limit = 100) {
  const r = await deps.db.query<{ code: string; created_by_handle: string | null; used_by_handle: string | null; used_by: string | null; created_at: Date; expires_at: Date; used_at: Date | null; expired: boolean }>(
    `SELECT i.code, c.handle AS created_by_handle, u.handle AS used_by_handle, i.used_by, i.created_at, i.expires_at, i.used_at, i.expires_at <= now() AS expired
       FROM invites i LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC, i.code LIMIT $1`, [Math.min(limit, 200)]);
  return {
    invites: r.rows.map((i) => ({
      code: i.code, created_by: i.created_by_handle, used_by: i.used_by_handle, used_by_id: i.used_by,
      created_at: new Date(i.created_at).toISOString(), expires_at: new Date(i.expires_at).toISOString(),
      used_at: i.used_at ? new Date(i.used_at).toISOString() : null,
      status: i.used_by ? 'used' : i.expired ? 'expired' : 'open',
    })),
  };
}
