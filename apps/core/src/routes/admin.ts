import type { FastifyInstance } from 'fastify';
import { grantOpSchema, roleSchema } from '@app/shared';
import { z } from 'zod';
import * as accounts from '../accounts';
import * as admin from '../admin';
import * as homes from '../homes/service';
import { deleteAccount } from '../deletion';
import * as widgets from '../homes/widgets';
import { ctxOf, requireAdmin } from '../http';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';

const inviteSchema = z.object({ expires_in_days: z.number().int().min(1).max(90).optional() }).default({});
const userIdParam = z.object({ id: z.string().regex(/^u_[0-9A-Z]{26}$/, 'not a user ID') });
// Every moderation-style action needs a reason. It goes in the audit log (docs/03).
const reason = z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500);
const roleBody = z.object({ role: roleSchema, reason });
const reasonBody = z.object({ reason });
const revokeParams = userIdParam.extend({ opId: z.string().regex(/^o_[0-9A-Z]{26}$/) });
const auditQuery = z.object({
  actor: z.string().max(40).optional(),
  target_type: z.string().max(40).optional(),
  target_id: z.string().max(100).optional(),
  action: z.string().max(80).optional(),
  origin: z.string().max(20).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const userListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: roleSchema.optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  before: z.string().regex(/^u_[0-9A-Z]{26}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function adminRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/admin/invites', async (req, reply) => {
    const who = requireAdmin(req);
    const { expires_in_days } = inviteSchema.parse(req.body ?? {});
    return reply.code(201).send(await accounts.createInvite(deps, who, expires_in_days, ctxOf(deps, req)));
  });

  app.get('/api/v1/admin/users', async (req) => {
    requireAdmin(req);
    return admin.listUsers(deps, userListQuery.parse(req.query));
  });

  app.get('/api/v1/admin/users/:id', async (req) => {
    requireAdmin(req);
    return admin.getDossier(deps, userIdParam.parse(req.params).id);
  });

  app.get('/api/v1/admin/invites', async (req) => {
    requireAdmin(req);
    return admin.listInvites(deps);
  });

  app.post('/api/v1/admin/users/:id/role', async (req) => {
    const who = requireAdmin(req);
    const { id } = userIdParam.parse(req.params);
    const body = roleBody.parse(req.body);
    return admin.setRole(deps, who, id, body.role, body.reason, ctxOf(deps, req));
  });

  app.post('/api/v1/admin/users/:id/rename', async (req) => {
    const who = requireAdmin(req);
    const { id } = userIdParam.parse(req.params);
    const body = z.object({ handle: z.string().max(40), reason }).parse(req.body);
    return admin.renameUser(deps, who, id, body.handle, body.reason, ctxOf(deps, req));
  });

  // Deleting someone's account on their behalf, for example when they ask by email (docs/12).
  app.post('/api/v1/admin/users/:id/delete', async (req, reply) => {
    const who = requireAdmin(req);
    const { id } = userIdParam.parse(req.params);
    if (id === who.userId) throw new ApiError(409, 'own_account', 'Use Settings to delete your own account.');
    const b = z.object({ reason, posts: z.enum(['keep', 'erase']) }).parse(req.body);
    await deleteAccount(deps, id, { posts: b.posts, actor: who, reason: b.reason }, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.post('/api/v1/admin/users/:id/suspend', async (req, reply) => {
    const who = requireAdmin(req);
    const { id } = userIdParam.parse(req.params);
    await admin.suspend(deps, who, id, reasonBody.parse(req.body).reason, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.post('/api/v1/admin/users/:id/unsuspend', async (req, reply) => {
    const who = requireAdmin(req);
    const { id } = userIdParam.parse(req.params);
    await admin.unsuspend(deps, who, id, reasonBody.parse(req.body).reason, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/users/:id/ops', async (req) => {
    requireAdmin(req);
    return admin.listOps(deps, userIdParam.parse(req.params).id);
  });

  app.post('/api/v1/admin/users/:id/ops', async (req, reply) => {
    const who = requireAdmin(req);
    const { id } = userIdParam.parse(req.params);
    const body = grantOpSchema.parse(req.body);
    return reply.code(201).send(await admin.grantOp(deps, who, id, body.scope, body.scope_id, body.reason, ctxOf(deps, req)));
  });

  app.delete('/api/v1/admin/users/:id/ops/:opId', async (req) => {
    const who = requireAdmin(req);
    const { id, opId } = revokeParams.parse(req.params);
    const body = z.object({ reason: reason.optional() }).default({}).parse(req.body ?? {});
    return admin.revokeOp(deps, who, id, opId, body.reason, ctxOf(deps, req));
  });

  // The audit log, newest first, with filters and ?before= paging (docs/14).
  app.get('/api/v1/admin/audit', async (req) => {
    requireAdmin(req);
    const q = auditQuery.parse(req.query);
    return admin.listAudit(deps, { actor: q.actor, targetType: q.target_type, targetId: q.target_id, action: q.action, origin: q.origin, from: q.from, to: q.to, before: q.before, limit: q.limit });
  });

  // Everything that happened to one object (a user now; boards and rings later), newest first.
  app.get('/api/v1/admin/audit/object/:type/:id', async (req) => {
    requireAdmin(req);
    const p = z.object({ type: z.string().max(40), id: z.string().max(100) }).parse(req.params);
    const q = auditQuery.pick({ before: true, limit: true }).parse(req.query);
    return admin.listAudit(deps, { targetType: p.type, targetId: p.id, before: q.before, limit: q.limit });
  });

  // Homepages (docs/07, docs/11): the list, and hiding one. Hidden pages are not served or listed.
  app.get('/api/v1/admin/homepages', async (req) => {
    requireAdmin(req);
    const q = z.object({
      q: z.string().trim().max(100).optional(), hidden: z.enum(['true', 'false']).optional(),
      before: z.string().regex(/^u_[0-9A-Z]{26}$/).optional(), limit: z.coerce.number().int().min(1).max(200).optional(),
    }).parse(req.query);
    return homes.adminList(deps, { ...q, hidden: q.hidden === undefined ? undefined : q.hidden === 'true' });
  });
  for (const hide of [true, false]) {
    app.post(`/api/v1/admin/homepages/:id/${hide ? 'hide' : 'restore'}`, async (req, reply) => {
      const who = requireAdmin(req);
      await homes.setHidden(deps, who, userIdParam.parse(req.params).id, hide, reasonBody.parse(req.body).reason, ctxOf(deps, req));
      return reply.code(204).send();
    });
  }
  app.post('/api/v1/admin/guestbook/:id/hide', async (req, reply) => {
    const who = requireAdmin(req);
    await widgets.adminHideEntry(deps, who, z.object({ id: z.string().regex(/^g_[0-9A-Z]{26}$/) }).parse(req.params).id, reasonBody.parse(req.body).reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
}
