import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bulletinSchema, onelinerSchema, pollSchema } from '@app/shared';
import { ctxOf, requireUser } from '../http';
import * as c from '../classics';
import type { AppDeps } from '../deps';

const idOf = (prefix: string) => z.object({ id: z.string().regex(new RegExp(`^${prefix}_[0-9A-Z]{26}$`), 'not a valid ID') });
const number = z.object({ number: z.coerce.number().int().min(1).max(1_000_000) });
const reason = z.object({ reason: z.string().trim().min(3).max(300) });

// Oneliners, bulletins and the voting booth (docs/04). All for signed-in, confirmed people; admin actions are audited.
export function classicsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const ip = (req: Parameters<typeof ctxOf>[1]) => ctxOf(deps, req).ipHash ?? undefined;

  app.get('/api/v1/oneliners', async (req) => c.listOneliners(deps, requireUser(req), z.coerce.number().int().min(1).max(50).catch(20).parse((req.query as { limit?: string }).limit)));
  app.post('/api/v1/oneliners', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await c.postOneliner(deps, requireUser(req), onelinerSchema.parse(req.body).body)));
  app.delete('/api/v1/oneliners/:id', async (req, reply) => { await c.deleteOwnOneliner(deps, requireUser(req), idOf('ol').parse(req.params).id); return reply.code(204).send(); });
  app.post('/api/v1/admin/oneliners/:id/hide', async (req, reply) => { await c.hideOneliner(deps, requireUser(req), idOf('ol').parse(req.params).id, true, reason.parse(req.body).reason, ip(req)); return reply.code(204).send(); });
  app.post('/api/v1/admin/oneliners/:id/unhide', async (req, reply) => { await c.hideOneliner(deps, requireUser(req), idOf('ol').parse(req.params).id, false, reason.parse(req.body).reason, ip(req)); return reply.code(204).send(); });

  app.get('/api/v1/bulletins', async (req) => c.listBulletins(deps, requireUser(req)));
  app.get('/api/v1/bulletins/:number', async (req) => c.readBulletin(deps, requireUser(req), number.parse(req.params).number));
  app.post('/api/v1/admin/bulletins', async (req, reply) => reply.code(201).send(await c.createBulletin(deps, requireUser(req), bulletinSchema.parse(req.body), ip(req))));
  app.patch('/api/v1/admin/bulletins/:number', async (req, reply) => { await c.editBulletin(deps, requireUser(req), number.parse(req.params).number, bulletinSchema.parse(req.body), ip(req)); return reply.code(204).send(); });
  app.post('/api/v1/admin/bulletins/:number/hide', async (req, reply) => { await c.hideBulletin(deps, requireUser(req), number.parse(req.params).number, reason.parse(req.body).reason, ip(req)); return reply.code(204).send(); });

  app.get('/api/v1/polls', async (req) => c.listPolls(deps, requireUser(req)));
  app.get('/api/v1/polls/:id', async (req) => c.getPoll(deps, requireUser(req), idOf('pl').parse(req.params).id));
  app.post('/api/v1/polls', { config: { rateLimit: { max: 5, timeWindow: '1 day' } } }, async (req, reply) => reply.code(201).send(await c.createPoll(deps, requireUser(req), pollSchema.parse(req.body))));
  app.post('/api/v1/polls/:id/vote', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req) =>
    c.vote(deps, requireUser(req), idOf('pl').parse(req.params).id, z.object({ option_id: z.string().regex(/^po_[0-9A-Z]{26}$/) }).parse(req.body).option_id));
  app.post('/api/v1/polls/:id/close', async (req, reply) => { await c.closePoll(deps, requireUser(req), idOf('pl').parse(req.params).id, ip(req)); return reply.code(204).send(); });
  app.post('/api/v1/admin/polls/:id/hide', async (req, reply) => { await c.hidePoll(deps, requireUser(req), idOf('pl').parse(req.params).id, reason.parse(req.body).reason, ip(req)); return reply.code(204).send(); });
}
