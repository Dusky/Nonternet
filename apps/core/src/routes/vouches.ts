import type { FastifyInstance } from 'fastify';
import { vouchCreateSchema } from '@app/shared';
import { z } from 'zod';
import { ctxOf, requireAdmin, requireUser } from '../http';
import type { AppDeps } from '../deps';
import * as vouches from '../vouches';

const userId = z.object({ id: z.string().regex(/^u_[0-9A-Z]{26}$/) });

// Vouching (docs/03).
export function vouchRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/me/vouches', async (req) => ({ vouches: await vouches.myVouches(deps, requireUser(req)) }));
  app.post('/api/v1/vouches', { config: { rateLimit: { max: 10, timeWindow: '1 day' } } }, async (req, reply) => {
    const b = vouchCreateSchema.parse(req.body);
    await vouches.vouch(deps, requireUser(req), b.handle, b.note, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/vouches/withdraw', async (req, reply) => {
    await vouches.withdraw(deps, requireUser(req), z.object({ handle: z.string().trim().min(1).max(40) }).parse(req.body).handle, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.get('/api/v1/admin/vouches', async (req) => {
    requireAdmin(req);
    return { candidates: await vouches.listCandidates(deps), needed: vouches.VOUCHES_NEEDED, hints: vouches.HINTS };
  });
  app.post('/api/v1/admin/vouches/:id/confirm', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    await vouches.confirm(deps, who, userId.parse(req.params).id, b.reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/admin/vouches/:id/decline', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500) }).parse(req.body);
    await vouches.decline(deps, who, userId.parse(req.params).id, b.reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
}
