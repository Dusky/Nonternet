import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { APP_DOC_MAX_BYTES, APP_PACKAGE_MAX_BYTES, REPORT_CATEGORIES, appCollectionSchema, appDocIdSchema, appGrantSchema, appIdSchema, appVersionSchema } from '@app/shared';
import * as apps from '../apps';
import * as authored from '../apps-authored';
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
  app.put('/api/v1/me/apps/:id', writes, async (req) => {
    const body = req.body && typeof req.body === 'object' && 'granted' in req.body ? appGrantSchema.parse(req.body).granted : undefined;
    return { app: await apps.installApp(deps, requireUser(req), appParam.parse(req.params).id, body) };
  });
  app.put('/api/v1/me/apps/:id/permissions', writes, async (req) => ({ app: await apps.setGrants(deps, requireUser(req), appParam.parse(req.params).id, appGrantSchema.parse(req.body).granted) }));
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

  // Apps made by trusted people (docs/10, 15): send a zip, see where each version stands, take an app back.
  app.get('/api/v1/me/apps-authored', async (req) => ({ apps: await authored.listAuthored(deps, requireUser(req)) }));
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: APP_PACKAGE_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));
    scope.post('/api/v1/me/apps-authored', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) =>
      reply.code(201).send({ app: await authored.submitApp(deps, requireUser(req), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), ctxOf(deps, req)) }));
  });
  app.delete('/api/v1/me/apps-authored/:id', async (req, reply) => {
    await authored.withdrawAuthored(deps, requireUser(req), appParam.parse(req.params).id, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/apps/:id/report', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({ category: z.enum(REPORT_CATEGORIES), note: z.string().trim().max(500).default('') }).parse(req.body);
    return reply.code(201).send(await authored.reportApp(deps, requireUser(req), appParam.parse(req.params).id, b.category, b.note, ctxOf(deps, req)));
  });
  app.get('/api/v1/admin/app-reviews', async (req) => { requireAdmin(req); return { reviews: await authored.reviewQueue(deps) }; });
  app.post('/api/v1/admin/app-reviews/:id/:version', async (req, reply) => {
    const v = requireAdmin(req);
    const p = appParam.extend({ version: appVersionSchema }).parse(req.params);
    const b = z.object({ decision: z.enum(['approve', 'decline']), reason: z.string().trim().max(1000).default('') }).parse(req.body);
    await authored.reviewVersion(deps, v, p.id, p.version, b.decision, b.reason, ctxOf(deps, req));
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
