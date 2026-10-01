import type { FastifyInstance } from 'fastify';
import { ringCreateSchema, ringHandleSchema, ringMemberActionSchema, ringOrderSchema, ringUpdateSchema, slugSchema } from '@app/shared';
import { z } from 'zod';
import { ctxOf, requireAdmin, requireUser } from '../http';
import type { AppDeps } from '../deps';
import * as banners from '../ring-banners';
import { ApiError } from '../errors';
import { ringNavScript } from '../homes/ring-script';
import * as rings from '../rings';
import { viewerOf } from '../boards';
import { WIDGET_API } from './widgets';

const slugParam = z.object({ slug: slugSchema });
const userId = z.string().regex(/^u_[0-9A-Z]{26}$/);
const from = z.object({ from: userId.optional() });

export function ringRoutes(app: FastifyInstance, deps: AppDeps): void {
  const viewer = (req: { session: Parameters<typeof viewerOf>[0] }) => viewerOf(req.session);

  app.get('/api/v1/rings', async (req) => rings.listRings(deps, viewer(req), z.object({
    tag: z.string().max(20).optional(), q: z.string().trim().max(100).optional(), sort: z.enum(['newest', 'active', 'name']).optional(),
    limit: z.coerce.number().int().min(1).max(60).optional(), offset: z.coerce.number().int().min(0).max(5000).optional(),
  }).parse(req.query)));
  app.get('/api/v1/rings/random', async () => {
    const r = await rings.randomRing(deps);
    if (!r) throw new ApiError(404, 'not_found', 'There are no rings yet.');
    return r;
  });
  app.post('/api/v1/rings', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await rings.createRing(deps, requireUser(req), ringCreateSchema.parse(req.body), ctxOf(deps, req))));
  app.get('/api/v1/rings/:slug', async (req) => rings.getRing(deps, viewer(req), slugParam.parse(req.params).slug));
  app.patch('/api/v1/rings/:slug', async (req) => rings.updateRing(deps, requireUser(req), slugParam.parse(req.params).slug, ringUpdateSchema.parse(req.body), ctxOf(deps, req)));

  app.post('/api/v1/rings/:slug/join', async (req) => rings.join(deps, requireUser(req), slugParam.parse(req.params).slug, ctxOf(deps, req)));
  app.post('/api/v1/rings/:slug/leave', async (req, reply) => {
    await rings.leave(deps, requireUser(req), slugParam.parse(req.params).slug, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/rings/:slug/invites', async (req, reply) => {
    await rings.invite(deps, requireUser(req), slugParam.parse(req.params).slug, ringHandleSchema.parse(req.body).handle, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.get('/api/v1/rings/:slug/members', async (req) => rings.listMembers(deps, viewer(req), slugParam.parse(req.params).slug, z.object({
    status: z.enum(['pending', 'invited', 'member', 'banned']).optional(), offset: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).optional(),
  }).parse(req.query)));
  app.post('/api/v1/rings/:slug/members/:userId/:action', async (req, reply) => {
    const p = slugParam.extend({ userId, action: z.enum(['approve', 'remove', 'ban', 'unban']) }).parse(req.params);
    await rings.memberAction(deps, requireUser(req), p.slug, p.userId, p.action, ringMemberActionSchema.parse(req.body ?? {}).reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.put('/api/v1/rings/:slug/order', async (req, reply) => {
    await rings.reorder(deps, requireUser(req), slugParam.parse(req.params).slug, ringOrderSchema.parse(req.body).user_ids);
    return reply.code(204).send();
  });

  app.post('/api/v1/rings/:slug/ops', async (req, reply) => {
    const b = ringHandleSchema.parse(req.body);
    await rings.addOp(deps, requireUser(req), slugParam.parse(req.params).slug, b.handle, b.reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.delete('/api/v1/rings/:slug/ops/:opId', async (req, reply) => {
    const p = slugParam.extend({ opId: z.string().regex(/^o_[0-9A-Z]{26}$/) }).parse(req.params);
    await rings.removeOp(deps, requireUser(req), p.slug, p.opId, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/rings/:slug/transfer', async (req, reply) => {
    await rings.transfer(deps, requireUser(req), slugParam.parse(req.params).slug, ringHandleSchema.parse(req.body).handle, ctxOf(deps, req));
    return reply.code(204).send();
  });

  // The snippet for a member's own page, in one of the classic styles.
  app.get('/api/v1/rings/:slug/snippet', async (req) => {
    const v = requireUser(req);
    const slug = slugParam.parse(req.params).slug;
    const style = z.enum(['bar', 'buttons', 'banner']).default('bar').parse((req.query as { style?: string }).style);
    const me = (await rings.getRingSummary(deps, v, slug)).me;
    if (me?.status !== 'member') throw new ApiError(403, 'not_a_member', 'Join the ring to get its nav bar.');
    return { html: rings.navSnippet(deps, slug, v.userId, style) };
  });

  // ---- banners (M9-E): the 468x60 and 88x31 pictures. Anyone may see the ones that are showing, so member pages can embed them.
  const kindParam = z.object({ kind: z.enum(['468x60', '88x31']) });
  app.get('/api/v1/rings/:slug/banners', async (req) => banners.listBanners(deps, viewer(req), slugParam.parse(req.params).slug));
  app.get('/api/v1/rings/:slug/banner/:kind', async (req, reply) => {
    const { slug } = slugParam.parse(req.params);
    const data = await banners.readBanner(deps, slug, kindParam.parse(req.params).kind);
    if (!data) return reply.code(404).send({ error: { code: 'not_found', message: 'No banner.' } });
    return reply.type('image/png').header('cache-control', 'public, max-age=300').header('x-content-type-options', 'nosniff').send(data);
  });
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: banners.BANNER_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));
    scope.put('/api/v1/rings/:slug/banner/:kind', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
      await banners.setBanner(deps, requireUser(req), slugParam.parse(req.params).slug, kindParam.parse(req.params).kind, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
      return reply.code(204).send();
    });
  });
  app.delete('/api/v1/rings/:slug/banner/:kind', async (req, reply) => {
    await banners.removeBanner(deps, requireUser(req), slugParam.parse(req.params).slug, kindParam.parse(req.params).kind);
    return reply.code(204).send();
  });
  for (const hide of [true, false]) {
    app.post(`/api/v1/rings/:slug/banner/:kind/${hide ? 'hide' : 'restore'}`, async (req, reply) => {
      await banners.hideBanner(deps, requireUser(req), slugParam.parse(req.params).slug, kindParam.parse(req.params).kind, hide, z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body).reason, ctxOf(deps, req).ipHash ?? undefined);
      return reply.code(204).send();
    });
  }

  // ---- the nav bar itself: public, no login, answers any site
  app.get(`${WIDGET_API}ring/:slug/nav`, async (req) => {
    const q = z.object({ member: userId.optional() }).parse(req.query);
    return rings.navInfo(deps, slugParam.parse(req.params).slug, q.member, req.headers.origin);
  });
  app.get('/ring/:slug/nav.js', async (req, reply) =>
    reply.type('text/javascript; charset=utf-8').header('cache-control', 'public, max-age=300').header('x-content-type-options', 'nosniff').send(ringNavScript(slugParam.parse(req.params).slug)));
  app.get('/ring/:slug/:dir', async (req, reply) => {
    const p = slugParam.extend({ dir: z.enum(['next', 'prev', 'random', 'list']) }).parse(req.params);
    const f = from.safeParse(req.query);
    const target = p.dir === 'list' ? `${deps.publicUrl}/rings/${p.slug}` : await rings.navTarget(deps, p.slug, p.dir, f.success ? f.data.from : undefined);
    return reply.redirect(target, 302);
  });

  // ---- admin
  app.get('/api/v1/admin/rings', async (req) => {
    requireAdmin(req);
    return rings.adminListRings(deps, z.object({ q: z.string().trim().max(100).optional(), before: z.string().regex(/^r_[0-9A-Z]{26}$/).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query));
  });
  for (const hide of [true, false]) {
    app.post(`/api/v1/admin/rings/:id/${hide ? 'hide' : 'restore'}`, async (req, reply) => {
      const who = requireAdmin(req);
      await rings.setRingHidden(deps, who, z.object({ id: z.string().regex(/^r_[0-9A-Z]{26}$/) }).parse(req.params).id, hide, z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body).reason, ctxOf(deps, req));
      return reply.code(204).send();
    });
  }
}
