import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { REPORT_CATEGORIES, fileAreaCreateSchema, fileAreaUpdateSchema, fileUpdateSchema, slugSchema } from '@app/shared';
import { z } from 'zod';
import { ctxOf, requireAdmin, requireUser } from '../http';
import type { AppDeps } from '../deps';
import type { SessionUser } from '../accounts';
import { ApiError } from '../errors';
import * as files from '../files';

const fileId = z.object({ id: z.string().regex(/^f_[0-9A-Z]{26}$/) });
const areaSlug = z.object({ slug: slugSchema });
const viewer = (s: SessionUser | null | undefined): SessionUser | null => (s && !s.limited ? s : null);

// The name as a download header: plain ASCII for old clients, and the real name in UTF-8 (RFC 6266).
export const contentDisposition = (name: string) =>
  `attachment; filename="${name.replace(/[^A-Za-z0-9._()+~-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// File areas (docs/05, M7).
export function fileRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/files', async (req) => ({ areas: await files.listAreas(deps, viewer(req.session)) }));
  app.get('/api/v1/files/areas/:slug', async (req) => files.areaWithFiles(deps, viewer(req.session), areaSlug.parse(req.params).slug));
  app.get('/api/v1/files/:id', async (req) => files.getFile(deps, viewer(req.session), fileId.parse(req.params).id));
  app.get('/api/v1/me/files', async (req) => files.usage(deps, requireUser(req)));

  // Always a download, never shown in the browser: whatever was uploaded can't run as a page here (docs/15).
  app.get('/api/v1/files/:id/download', async (req, reply) => {
    const f = await files.openForDownload(deps, viewer(req.session), fileId.parse(req.params).id);
    return reply.type('application/octet-stream').header('content-disposition', contentDisposition(f.name)).header('content-length', f.size)
      .header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; sandbox").header('cache-control', 'private, no-cache')
      .header('etag', `"${f.sha256}"`).send(createReadStream(f.path));
  });

  app.patch('/api/v1/files/:id', async (req) => files.updateFile(deps, requireUser(req), fileId.parse(req.params).id, fileUpdateSchema.parse(req.body)));
  app.delete('/api/v1/files/:id', async (req, reply) => {
    const b = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    await files.deleteFile(deps, requireUser(req), fileId.parse(req.params).id, b.reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/files/:id/report', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({ category: z.enum(REPORT_CATEGORIES), note: z.string().trim().max(500).default('') }).parse(req.body);
    return reply.code(201).send(await files.reportFile(deps, requireUser(req), fileId.parse(req.params).id, b.category, b.note, ctxOf(deps, req)));
  });

  // Uploads send the file as the request body and its name, title and description in the query string.
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: files.maxFileBytes(deps) + 1 }, (_req, body, done) => done(null, body));
    scope.post('/api/v1/files/areas/:slug/files', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
      const v = requireUser(req);
      const meta = z.object({ name: z.string().max(400), title: z.string().trim().max(120).default(''), description: z.string().trim().max(2000).default('') }).parse(req.query);
      if (req.body !== undefined && !Buffer.isBuffer(req.body)) throw new ApiError(400, 'bad_request', 'Send the file itself as the request body.');
      return reply.code(201).send(await files.upload(deps, v, areaSlug.parse(req.params).slug, meta, (req.body as Buffer | undefined) ?? Buffer.alloc(0)));
    });
  });

  app.post('/api/v1/admin/files/areas', async (req, reply) => reply.code(201).send(await files.createArea(deps, requireAdmin(req), fileAreaCreateSchema.parse(req.body), ctxOf(deps, req))));
  app.patch('/api/v1/admin/files/areas/:slug', async (req) => files.updateArea(deps, requireAdmin(req), areaSlug.parse(req.params).slug, fileAreaUpdateSchema.parse(req.body), ctxOf(deps, req)));
  for (const hidden of [true, false]) {
    app.post(`/api/v1/admin/files/:id/${hidden ? 'hide' : 'unhide'}`, async (req, reply) => {
      const b = z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500) }).parse(req.body);
      await files.setHidden(deps, requireAdmin(req), fileId.parse(req.params).id, hidden, b.reason, ctxOf(deps, req));
      return reply.code(204).send();
    });
  }
}
