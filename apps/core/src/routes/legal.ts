import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireAdmin } from '../http';
import type { AppDeps } from '../deps';
import * as legal from '../legal';

const slug = z.object({ slug: z.string().max(40) });

export function legalRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/legal/:slug', async (req, reply) => reply.header('cache-control', 'no-cache').send(await legal.getPage(deps, slug.parse(req.params).slug)));
  // Anyone can send a request, signed in or not; it is rate limited by address.
  app.post('/api/v1/legal/requests', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(legal.REQUEST_KINDS), url: z.string().trim().url().max(500), description: z.string().trim().min(10, 'say what is wrong (at least 10 characters)').max(4000),
      contact_name: z.string().trim().min(2).max(120), contact_email: z.string().trim().email().max(254), good_faith: z.boolean(),
    }).parse(req.body);
    return reply.code(201).send(await legal.submitRequest(deps, b, ctxOf(deps, req)));
  });

  app.get('/api/v1/admin/legal/pages', async (req) => { requireAdmin(req); return { pages: await legal.listPages(deps) }; });
  app.get('/api/v1/admin/legal/pages/:slug/versions', async (req) => { requireAdmin(req); return { versions: await legal.pageVersions(deps, slug.parse(req.params).slug) }; });
  app.put('/api/v1/admin/legal/pages/:slug', async (req) => {
    const who = requireAdmin(req);
    const b = z.object({ title: z.string().trim().min(2).max(120), body: z.string().trim().min(20).max(60_000), reason: z.string().trim().min(3).max(500) }).parse(req.body);
    return legal.savePage(deps, who, slug.parse(req.params).slug, b, ctxOf(deps, req));
  });
  app.get('/api/v1/admin/legal/requests', async (req) => {
    requireAdmin(req);
    const q = z.object({ status: z.enum(['open', 'actioned', 'declined']).optional() }).parse(req.query);
    return { requests: await legal.listRequests(deps, q.status) };
  });
  app.post('/api/v1/admin/legal/requests/:id/resolve', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ status: z.enum(['actioned', 'declined']), note: z.string().trim().min(3).max(1000) }).parse(req.body);
    await legal.resolveRequest(deps, who, z.object({ id: z.string().regex(/^lr_[0-9A-Z]{26}$/) }).parse(req.params).id, b.status, b.note, ctxOf(deps, req));
    return reply.code(204).send();
  });
}
