import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { memoCreateSchema, memoListQuerySchema, memoUpdateSchema } from '@app/shared';
import { requireUser } from '../http';
import type { AppDeps } from '../deps';
import * as memos from '../memos';

const id = z.object({ id: z.string().regex(/^mm_[0-9A-Z]{26}$/, 'not a memo ID') });

// Memos (docs/22): the signed-in person's own notes.
export function memoRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/memos', async (req) => memos.listMemos(deps, requireUser(req), memoListQuerySchema.parse(req.query)));
  app.get('/api/v1/memos/hub', async (req) => memos.hub(deps, requireUser(req)));
  app.get('/api/v1/memos/tags', async (req) => ({ tags: await memos.tagCounts(deps, requireUser(req)) }));
  app.post('/api/v1/memos', { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await memos.addMemo(deps, requireUser(req), memoCreateSchema.parse(req.body))));
  app.get('/api/v1/memos/:id', async (req) => memos.getMemo(deps, requireUser(req), id.parse(req.params).id));
  app.patch('/api/v1/memos/:id', async (req) => memos.updateMemo(deps, requireUser(req), id.parse(req.params).id, memoUpdateSchema.parse(req.body)));
  app.delete('/api/v1/memos/:id', async (req, reply) => {
    await memos.deleteMemo(deps, requireUser(req), id.parse(req.params).id);
    return reply.code(204).send();
  });
}
