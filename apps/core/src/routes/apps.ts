import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_DOC_MAX_BYTES, appCollectionSchema, appDocIdSchema, appIdSchema } from '@app/shared';
import * as apps from '../apps';
import type { AppDeps } from '../deps';
import { ctxOf, requireAdmin, requireUser } from '../http';

const appParam = z.object({ id: appIdSchema });
const colParam = appParam.extend({ collection: appCollectionSchema });
const docParam = colParam.extend({ doc: appDocIdSchema });
const writes = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

// Apps people add to their own desktop (docs/10, docs/15). Everything here is for signed-in people; the data
// routes are what the shell's bridge calls on an app's behalf.
export function appsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/apps', async (req) => ({ apps: await apps.listCatalog(deps, requireUser(req)) }));
  app.get('/api/v1/me/apps', async (req) => ({ apps: await apps.listInstalled(deps, requireUser(req)) }));
  app.put('/api/v1/me/apps/:id', writes, async (req) => ({ app: await apps.installApp(deps, requireUser(req), appParam.parse(req.params).id) }));
  app.delete('/api/v1/me/apps/:id', writes, async (req, reply) => {
    await apps.removeApp(deps, requireUser(req), appParam.parse(req.params).id);
    return reply.code(204).send();
  });
  app.delete('/api/v1/me/apps/:id/data', writes, async (req) => apps.deleteAppData(deps, requireUser(req), appParam.parse(req.params).id));

  app.get('/api/v1/me/apps/:id/data/:collection', async (req) => {
    const p = colParam.parse(req.params);
    return { docs: await apps.listDocs(deps, requireUser(req), p.id, p.collection) };
  });
  app.put('/api/v1/me/apps/:id/data/:collection/:doc', { ...writes, bodyLimit: APP_DOC_MAX_BYTES * 2 }, async (req) => {
    const p = docParam.parse(req.params);
    return { doc: await apps.putDoc(deps, requireUser(req), p.id, p.collection, p.doc, (req.body as { data?: unknown } | undefined)?.data) };
  });
  app.delete('/api/v1/me/apps/:id/data/:collection/:doc', writes, async (req, reply) => {
    const p = docParam.parse(req.params);
    await apps.deleteDoc(deps, requireUser(req), p.id, p.collection, p.doc);
    return reply.code(204).send();
  });

  // The admin console's Apps page.
  app.get('/api/v1/admin/apps', async (req) => { requireAdmin(req); return { apps: await apps.adminListApps(deps) }; });
  app.put('/api/v1/admin/apps/:id', async (req, reply) => {
    const v = requireAdmin(req);
    const b = z.object({ offered: z.boolean() }).parse(req.body);
    await apps.setOffered(deps, v, appParam.parse(req.params).id, b.offered, ctxOf(deps, req).ipHash ?? null);
    return reply.code(204).send();
  });
}
