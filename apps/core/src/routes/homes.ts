import type { FastifyInstance } from 'fastify';
import { homeFolderSchema, homeMoveSchema, homepageSettingsSchema, homeTemplateSchema } from '@app/shared';
import { z } from 'zod';
import { requireUser } from '../http';
import type { AppDeps } from '../deps';
import { cleanPath, isEditable } from '../homes/files';
import * as homes from '../homes/service';
import { TEMPLATES } from '../homes/templates';
import { ApiError } from '../errors';

const pathQuery = z.object({ path: z.string().max(200) });

export function homeRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/homes/templates', async () => ({ templates: TEMPLATES.map((t) => ({ id: t.id, title: t.title, description: t.description })) }));

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
