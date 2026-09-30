import type { FastifyInstance } from 'fastify';
import { homeFolderSchema, homeMoveSchema, homepageSettingsSchema, homeTemplateSchema } from '@app/shared';
import { z } from 'zod';
import { requireUser } from '../http';
import type { AppDeps } from '../deps';
import { cleanPath, isEditable } from '../homes/files';
import * as homes from '../homes/service';
import { ASSETS, assetById } from '../homes/assets';
import { TEMPLATES } from '../homes/templates';
import { ApiError } from '../errors';

const pathQuery = z.object({ path: z.string().max(200) });

export function homeRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/homes/templates', async () => ({ templates: TEMPLATES.map((t) => ({ id: t.id, title: t.title, description: t.description })) }));

  // The directory of homepages (docs/07): recently updated, search, and a random one.
  app.get('/api/v1/homepages', async (req) => homes.directory(deps, z.object({
    q: z.string().trim().max(100).optional(), sort: z.enum(['recent', 'name']).optional(),
    limit: z.coerce.number().int().min(1).max(60).optional(), offset: z.coerce.number().int().min(0).max(5000).optional(),
  }).parse(req.query)));
  app.get('/api/v1/homepages/random', async () => {
    const r = await homes.randomHomepage(deps);
    if (!r) throw new ApiError(404, 'not_found', 'There are no homepages yet.');
    return r;
  });

  app.get('/api/v1/homes/assets', async () => ({ assets: ASSETS.map((a) => ({ id: a.id, title: a.title, category: a.category, width: a.width, height: a.height })) }));
  // The picture itself, for the studio to show. Locked down so a browser only ever draws it.
  app.get('/api/v1/homes/assets/:id', async (req, reply) => {
    const a = assetById(z.object({ id: z.string().max(60) }).parse(req.params).id.replace(/\.svg$/, ''));
    if (!a) throw new ApiError(404, 'not_found', 'No such asset.');
    return reply.type('image/svg+xml').header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'").header('x-content-type-options', 'nosniff').header('cache-control', 'public, max-age=86400').send(a.svg);
  });
  app.post('/api/v1/homes/me/assets', async (req) => homes.addAsset(deps, requireUser(req), z.object({ id: z.string().max(60) }).parse(req.body).id));

  app.get('/api/v1/homes/me', async (req) => homes.getMine(deps, requireUser(req)));

  app.patch('/api/v1/homes/me', async (req, reply) => {
    await homes.updateSettings(deps, requireUser(req), homepageSettingsSchema.parse(req.body));
    return reply.code(204).send();
  });

  app.post('/api/v1/homes/me/template', async (req, reply) => {
    const b = homeTemplateSchema.parse(req.body);
    await homes.applyTemplate(deps, requireUser(req), b.template, b.replace);
    return reply.code(204).send();
  });

  app.post('/api/v1/homes/me/folders', async (req, reply) => {
    await homes.makeFolder(deps, requireUser(req), cleanPath(homeFolderSchema.parse(req.body).path));
    return reply.code(201).send();
  });

  app.post('/api/v1/homes/me/move', async (req, reply) => {
    const b = homeMoveSchema.parse(req.body);
    await homes.movePath(deps, requireUser(req), cleanPath(b.from), cleanPath(b.to));
    return reply.code(204).send();
  });

  app.delete('/api/v1/homes/me/file', async (req, reply) => {
    await homes.removePath(deps, requireUser(req), cleanPath(pathQuery.parse(req.query).path));
    return reply.code(204).send();
  });

  // The text of a file, for the editor.
  app.get('/api/v1/homes/me/file', async (req) => {
    const v = requireUser(req);
    homes.assertCanHost(v);
    const path = cleanPath(pathQuery.parse(req.query).path);
    if (!isEditable(path)) throw new ApiError(415, 'not_text', 'That kind of file cannot be edited here.');
    return { path, content: (await deps.homes.read(v.userId, path)).toString('utf8') };
  });

  // Uploads send the file itself as the request body, so there is no form parsing to get wrong.
  // The body limit is the largest file the site allows.
  app.register(async (scope) => {
    // Only the raw-body parser applies here, whatever the upload claims to be (text/plain and
    // application/json would otherwise be parsed as strings or objects and the file would come out empty).
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: homes.fileMaxBytes(deps) }, (_req, body, done) => done(null, body));
    scope.put('/api/v1/homes/me/file', async (req, reply) => {
      const v = requireUser(req);
      const path = cleanPath(pathQuery.parse(req.query).path);
      if (req.body !== undefined && !Buffer.isBuffer(req.body)) throw new ApiError(400, 'bad_request', 'Send the file itself as the request body.');
      await homes.putFile(deps, v, path, (req.body as Buffer | undefined) ?? Buffer.alloc(0));
      return reply.code(204).send();
    });
  });
}
