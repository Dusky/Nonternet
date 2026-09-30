import type { FastifyInstance } from 'fastify';
import { boardOpAddSchema, modActionSchema, modUndoSchema, reportCreateSchema, reportResolveSchema, slugSchema } from '@app/shared';
import { z } from 'zod';
import * as mod from '../moderation';
import * as widgets from '../homes/widgets';
import { ctxOf, requireUser } from '../http';
import type { AppDeps } from '../deps';
import { viewerOf } from '../boards';

const slugParam = z.object({ slug: slugSchema });
const idParam = (prefix: string) => z.object({ id: z.string().regex(new RegExp(`^${prefix}_[0-9A-Z]{26}$`), 'not a valid ID') });

export function moderationRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/mod-actions', async (req, reply) =>
    reply.code(201).send(await mod.modAction(deps, requireUser(req), modActionSchema.parse(req.body), ctxOf(deps, req))));

  app.post('/api/v1/mod-actions/:id/undo', async (req, reply) =>
    reply.code(201).send(await mod.undoModAction(deps, requireUser(req), idParam('m').parse(req.params).id, modUndoSchema.parse(req.body ?? {}).reason, ctxOf(deps, req))));

  app.get('/api/v1/modlog', async (req) =>
    mod.modLog(deps, viewerOf(req.session), z.object({ board: slugSchema.optional(), before: z.string().regex(/^m_[0-9A-Z]{26}$/).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query)));

  app.post('/api/v1/reports', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await (async () => {
      const b = reportCreateSchema.parse(req.body);
      const v = requireUser(req);
      const ctx = ctxOf(deps, req);
      if ('post_id' in b) return mod.createReport(deps, v, b, ctx);
      if ('homepage' in b) return widgets.reportHomepage(deps, v, b.homepage, b.category, b.note, ctx);
      return widgets.reportEntry(deps, v, b.guestbook_entry, b.category, b.note, ctx);
    })()));

  app.get('/api/v1/reports', async (req) =>
    mod.listReports(deps, requireUser(req), z.object({
      status: z.enum(['open', 'actioned', 'dismissed', 'all']).optional(), board: slugSchema.optional(),
      before: z.string().regex(/^rp_[0-9A-Z]{26}$/).optional(), limit: z.coerce.number().int().min(1).max(100).optional(),
    }).parse(req.query)));

  app.post('/api/v1/reports/:id/resolve', async (req, reply) => {
    const body = reportResolveSchema.parse(req.body);
    await mod.resolveReport(deps, requireUser(req), idParam('rp').parse(req.params).id, body.resolution, body.note, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.get('/api/v1/boards/:slug/ops', async (req) => ({ ops: await mod.listBoardOps(deps, requireUser(req), slugParam.parse(req.params).slug) }));
  app.post('/api/v1/boards/:slug/ops', async (req, reply) => {
    const body = boardOpAddSchema.parse(req.body);
    await mod.addBoardOp(deps, requireUser(req), slugParam.parse(req.params).slug, body.handle, body.reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.delete('/api/v1/boards/:slug/ops/:opId', async (req, reply) => {
    const p = slugParam.extend({ opId: z.string().regex(/^o_[0-9A-Z]{26}$/) }).parse(req.params);
    await mod.removeBoardOp(deps, requireUser(req), p.slug, p.opId, undefined, ctxOf(deps, req));
    return reply.code(204).send();
  });
}
