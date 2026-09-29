import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as accounts from '../accounts';
import { ctxOf, requireAdmin } from '../http';
import type { AppDeps } from '../deps';

const inviteSchema = z.object({ expires_in_days: z.number().int().min(1).max(90).optional() }).default({});

export function adminRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/admin/invites', async (req, reply) => {
    const admin = requireAdmin(req);
    const { expires_in_days } = inviteSchema.parse(req.body ?? {});
    return reply.code(201).send(await accounts.createInvite(deps, admin, expires_in_days, ctxOf(deps, req)));
  });
}
