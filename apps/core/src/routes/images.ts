import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IMAGE_UPLOAD_MAX_BYTES } from '@app/shared';
import { requireAdmin, requireUser, ctxOf } from '../http';
import { viewerOf } from '../boards';
import type { AppDeps } from '../deps';
import * as images from '../images';

const id = z.object({ id: z.string().regex(/^i_[0-9A-Z]{26}$/, 'not a picture ID') });

// Pictures in posts and mail (docs/23, E6).
export function imageRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: IMAGE_UPLOAD_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));
    scope.post('/api/v1/images', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
      const q = z.object({ alt: z.string().max(200).optional() }).parse(req.query);
      return reply.code(201).send(await images.uploadImage(deps, requireUser(req), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), q.alt ?? ''));
    });
  });
  app.get('/api/v1/images/:id', async (req, reply) => {
    const r = await images.readImage(deps, viewerOf(req.session), id.parse(req.params).id);
    return reply.type('image/webp').header('x-content-type-options', 'nosniff').header('content-security-policy', 'sandbox')
      .header('cache-control', r.public ? 'public, max-age=86400' : 'private, max-age=86400').send(r.data);
  });
  app.post('/api/v1/admin/images/:id/hide', async (req, reply) => {
    await images.hideImage(deps, requireAdmin(req), id.parse(req.params).id, true, z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body).reason, ctxOf(deps, req).ipHash ?? undefined);
    return reply.code(204).send();
  });
  app.post('/api/v1/admin/images/:id/restore', async (req, reply) => {
    await images.hideImage(deps, requireAdmin(req), id.parse(req.params).id, false, z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body).reason, ctxOf(deps, req).ipHash ?? undefined);
    return reply.code(204).send();
  });
}
