import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REACTIONS, REPORT_CATEGORIES, memoCreateSchema, memoListQuerySchema, memoReplySchema, memoUpdateSchema } from '@app/shared';
import { ctxOf, requireUser } from '../http';
import { viewerOf } from '../boards';
import type { AppDeps } from '../deps';
import * as memos from '../memos';

const id = z.object({ id: z.string().regex(/^mm_[0-9A-Z]{26}$/, 'not a memo ID') });

// Memos (docs/22): the signed-in person's own notes, and the ones people shared (public, or into a ring).
export function memoRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/memos', async (req) => memos.listMemos(deps, requireUser(req), memoListQuerySchema.parse(req.query)));
  app.get('/api/v1/memos/hub', async (req) => memos.hub(deps, requireUser(req)));
  app.get('/api/v1/memos/tags', async (req) => ({ tags: await memos.tagCounts(deps, requireUser(req)) }));
  app.post('/api/v1/memos', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await memos.addMemo(deps, requireUser(req), memoCreateSchema.parse(req.body))));
  app.get('/api/v1/memos/rings', async (req) => ({ rings: await memos.shareableRings(deps, requireUser(req)) }));
  // Shared ones: public memos are readable without signing in; a ring's are for its members.
  const before = z.object({ before: z.string().max(80).optional() });
  app.get('/api/v1/memos/public/:handle', async (req) =>
    memos.publicMemos(deps, viewerOf(req.session), z.object({ handle: z.string().min(1).max(40) }).parse(req.params).handle, before.parse(req.query).before));
  app.get('/api/v1/rings/:slug/memos', async (req) =>
    memos.ringMemos(deps, viewerOf(req.session), z.object({ slug: z.string().min(1).max(40) }).parse(req.params).slug, before.parse(req.query).before));
  app.get('/api/v1/memos/:id/thread', async (req) => memos.getThread(deps, viewerOf(req.session), id.parse(req.params).id));
  app.post('/api/v1/memos/:id/replies', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await memos.reply(deps, requireUser(req), id.parse(req.params).id, memoReplySchema.parse(req.body))));
  const named = z.object({ id: id.shape.id, name: z.enum(REACTIONS) });
  for (const [method, on] of [['put', true], ['delete', false]] as const) {
    app[method]('/api/v1/memos/:id/reactions/:name', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req) => {
      const p = named.parse(req.params);
      return memos.react(deps, requireUser(req), p.id, p.name, on);
    });
  }
  app.post('/api/v1/memos/:id/report', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({ category: z.enum(REPORT_CATEGORIES), note: z.string().trim().max(500).default('') }).parse(req.body);
    return reply.code(201).send(await memos.reportMemo(deps, requireUser(req), id.parse(req.params).id, b.category, b.note, ctxOf(deps, req)));
  });
  const reason = z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500) });
  for (const [path, hide] of [['hide', true], ['restore', false]] as const) {
    app.post(`/api/v1/memos/:id/${path}`, async (req, reply) => {
      await memos.hideMemo(deps, requireUser(req), id.parse(req.params).id, hide, reason.parse(req.body).reason, ctxOf(deps, req));
      return reply.code(204).send();
    });
  }
  app.get('/api/v1/memos/:id', async (req) => memos.getMemo(deps, requireUser(req), id.parse(req.params).id));
  app.patch('/api/v1/memos/:id', async (req) => memos.updateMemo(deps, requireUser(req), id.parse(req.params).id, memoUpdateSchema.parse(req.body)));
  app.delete('/api/v1/memos/:id', async (req, reply) => {
    await memos.deleteMemo(deps, requireUser(req), id.parse(req.params).id);
    return reply.code(204).send();
  });
}
