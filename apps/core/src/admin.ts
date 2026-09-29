import { OP_ROLE, opClaim, type OpScope, type Role } from '@app/shared';
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
// TODO(M2, M3): check that the board or ring exists. Until they do, only the ID's shape is checked.
export async function grantOp(deps: AppDeps, admin: SessionUser, targetId: string, scope: OpScope, scopeId: string, reason: string | undefined, ctx: Ctx): Promise<{ id: string; ops: string[]; role_rev: number }> {
  return deps.db.tx(async (q) => {
    const t = await lockTarget(q, targetId);
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
async function finishOpsChange(q: Queryable, admin: SessionUser, targetId: string, change: 'granted' | 'revoked', claim: string, reason: string | undefined, ctx: Ctx, id = ''): Promise<{ id: string; ops: string[]; role_rev: number }> {
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
