import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bookmarkCreateSchema, bookmarkListQuerySchema, bookmarkUpdateSchema } from '@app/shared';
import { requireUser } from '../http';
import type { AppDeps } from '../deps';
import * as bookmarks from '../bookmarks';

const id = z.object({ id: z.string().regex(/^bm_[0-9A-Z]{26}$/, 'not a bookmark ID') });

// Bookmarks (docs/21). All of them are the signed-in person's own; sharing comes later (B3).
export function bookmarkRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/bookmarks', async (req) => bookmarks.listBookmarks(deps, requireUser(req), bookmarkListQuerySchema.parse(req.query)));
  app.get('/api/v1/bookmarks/hub', async (req) => bookmarks.hub(deps, requireUser(req)));
  app.get('/api/v1/bookmarks/tags', async (req) => ({ tags: await bookmarks.tagCounts(deps, requireUser(req)) }));
  // Reading the page is the costly part, so adding is limited.
  app.post('/api/v1/bookmarks', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await bookmarks.addBookmark(deps, requireUser(req), bookmarkCreateSchema.parse(req.body));
    return reply.code(r.existing ? 200 : 201).send(r);
  });
  app.get('/api/v1/bookmarks/:id', async (req) => bookmarks.getBookmark(deps, requireUser(req), id.parse(req.params).id));
  app.patch('/api/v1/bookmarks/:id', async (req) => bookmarks.updateBookmark(deps, requireUser(req), id.parse(req.params).id, bookmarkUpdateSchema.parse(req.body)));
  app.delete('/api/v1/bookmarks/:id', async (req, reply) => {
    await bookmarks.deleteBookmark(deps, requireUser(req), id.parse(req.params).id);
    return reply.code(204).send();
  });
  app.get('/api/v1/bookmarks/:id/icon', async (req, reply) => {
    const data = await bookmarks.readIcon(deps, requireUser(req), id.parse(req.params).id);
    return reply.type('image/webp').header('x-content-type-options', 'nosniff').header('content-security-policy', 'sandbox')
      .header('cache-control', 'private, max-age=604800').send(data);
  });
}
