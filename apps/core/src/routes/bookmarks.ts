import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORT_CATEGORIES, bookmarkCreateSchema, bookmarkListQuerySchema, bookmarkUpdateSchema } from '@app/shared';
import { ctxOf, requireUser } from '../http';
import { viewerOf } from '../boards';
import type { AppDeps } from '../deps';
import * as bookmarks from '../bookmarks';

const id = z.object({ id: z.string().regex(/^bm_[0-9A-Z]{26}$/, 'not a bookmark ID') });

// Bookmarks (docs/21): the signed-in person's own, and the ones people shared (public, or into a ring).
export function bookmarkRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/bookmarks', async (req) => bookmarks.listBookmarks(deps, requireUser(req), bookmarkListQuerySchema.parse(req.query)));
  app.get('/api/v1/bookmarks/hub', async (req) => bookmarks.hub(deps, requireUser(req)));
  app.get('/api/v1/bookmarks/rings', async (req) => ({ rings: await bookmarks.shareableRings(deps, requireUser(req)) }));
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
    const icon = await bookmarks.readIcon(deps, viewerOf(req.session), id.parse(req.params).id);
    return reply.type('image/webp').header('x-content-type-options', 'nosniff').header('content-security-policy', 'sandbox')
      .header('cache-control', `${icon.shared ? 'public' : 'private'}, max-age=86400`).send(icon.data);
  });
  // Shared ones: readable without signing in.
  const before = z.object({ before: z.string().max(80).optional() });
  app.get('/api/v1/bookmarks/public/:handle', async (req) =>
    bookmarks.publicBookmarks(deps, viewerOf(req.session), z.object({ handle: z.string().min(1).max(40) }).parse(req.params).handle, before.parse(req.query).before));
  app.get('/api/v1/rings/:slug/bookmarks', async (req) =>
    bookmarks.ringBookmarks(deps, viewerOf(req.session), z.object({ slug: z.string().min(1).max(40) }).parse(req.params).slug, before.parse(req.query).before));
  const reportBody = z.object({ category: z.enum(REPORT_CATEGORIES), note: z.string().trim().max(500).default('') });
  app.post('/api/v1/bookmarks/:id/report', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = reportBody.parse(req.body);
    return reply.code(201).send(await bookmarks.reportBookmark(deps, requireUser(req), id.parse(req.params).id, b.category, b.note, ctxOf(deps, req)));
  });
  const reason = z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500) });
  for (const [path, hide] of [['hide', true], ['restore', false]] as const) {
    app.post(`/api/v1/bookmarks/:id/${path}`, async (req, reply) => {
      await bookmarks.hideBookmark(deps, requireUser(req), id.parse(req.params).id, hide, reason.parse(req.body).reason, ctxOf(deps, req));
      return reply.code(204).send();
    });
  }
}
