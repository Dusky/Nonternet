import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AVATAR_MAX_BYTES, WALLPAPER_MAX_BYTES, wallpaperFromUrlSchema, wallpaperUpdateSchema, CLIENT_NAMES, CLIENT_SETTINGS_MAX_BYTES, notificationPrefSchema, type ClientName } from '@app/shared';
import { getClientSettings, putClientSettings } from '../client-settings';
import { ctxOf, requireAdmin, requireUser } from '../http';
import * as personal from '../personal';
import * as wallpaper from '../wallpaper';
import type { AppDeps } from '../deps';

const userId = z.object({ id: z.string().regex(/^u_[0-9A-Z]{26}$/, 'not a user ID') });
const slug = z.object({ slug: z.string().max(40) });
const threadId = z.object({ id: z.string().max(40) });

// Avatars, preferences, mutes and the people directory (docs/10, 12). All of it is for signed-in people.
export function personalRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/me/personal', async (req) => personal.getSettings(deps, requireUser(req)));

  // Chat and MUD client settings, kept on the account (docs/08, 18).
  const clientName = z.object({ client: z.enum(CLIENT_NAMES as [ClientName, ...ClientName[]]) });
  app.get('/api/v1/me/client-settings/:client', async (req) => {
    const v = requireUser(req);
    return { settings: await getClientSettings(deps.db, v.userId, clientName.parse(req.params).client) };
  });
  app.put('/api/v1/me/client-settings/:client', { bodyLimit: CLIENT_SETTINGS_MAX_BYTES * 2, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const v = requireUser(req);
    return { settings: await putClientSettings(deps, v, clientName.parse(req.params).client, (req.body as { settings?: unknown } | undefined)?.settings) };
  });
  app.put('/api/v1/me/notification-prefs', async (req, reply) => {
    const b = notificationPrefSchema.parse(req.body);
    await personal.setPref(deps, requireUser(req), b.kind, b.enabled);
    return reply.code(204).send();
  });
  app.put('/api/v1/boards/:slug/mute', async (req, reply) => {
    await personal.muteBoard(deps, requireUser(req), slug.parse(req.params).slug, true);
    return reply.code(204).send();
  });
  app.delete('/api/v1/boards/:slug/mute', async (req, reply) => {
    await personal.muteBoard(deps, requireUser(req), slug.parse(req.params).slug, false);
    return reply.code(204).send();
  });
  app.put('/api/v1/mail/:id/mute', async (req, reply) => {
    await personal.muteThread(deps, requireUser(req), threadId.parse(req.params).id, true);
    return reply.code(204).send();
  });
  app.delete('/api/v1/mail/:id/mute', async (req, reply) => {
    await personal.muteThread(deps, requireUser(req), threadId.parse(req.params).id, false);
    return reply.code(204).send();
  });

  // Avatars: one picture per person, drawn again on upload. The list says who has one, so no one asks for a picture that is not there.
  app.get('/api/v1/avatars', async (req) => ({ avatars: await personal.avatarVersions(deps, requireUser(req)) }));
  app.get('/api/v1/avatars/:id', async (req, reply) => {
    const a = await personal.readAvatar(deps, requireUser(req), userId.parse(req.params).id);
    if (!a) return reply.code(404).send({ error: { code: 'not_found', message: 'No avatar.' } });
    return reply.type('image/webp').header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(a.data);
  });
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: AVATAR_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));
    scope.put('/api/v1/me/avatar', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) =>
      personal.setAvatar(deps, requireUser(req), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)));
  });
  app.delete('/api/v1/me/avatar', async (req, reply) => {
    await personal.clearAvatar(deps, requireUser(req).userId);
    return reply.code(204).send();
  });
  // The desktop wallpaper (docs/10): the choice, and the person's own picture, which only they can see.
  app.get('/api/v1/me/wallpaper', async (req) => wallpaper.getSettings(deps.db, requireUser(req).userId));
  app.put('/api/v1/me/wallpaper', async (req) => { const b = wallpaperUpdateSchema.parse(req.body); return wallpaper.choose(deps, requireUser(req), b.choice, b.fit); });
  app.get('/api/v1/me/wallpaper/image', async (req, reply) => {
    const w = await wallpaper.read(deps, requireUser(req).userId);
    if (!w) return reply.code(404).send({ error: { code: 'not_found', message: 'No picture.' } });
    return reply.type('image/webp').header('cache-control', 'private, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').send(w.data);
  });
  app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: WALLPAPER_MAX_BYTES + 1 }, (_req, body, done) => done(null, body));
    scope.put('/api/v1/me/wallpaper/image', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) =>
      wallpaper.upload(deps, requireUser(req), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)));
  });
  app.post('/api/v1/me/wallpaper/from-url', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) =>
    wallpaper.fromUrl(deps, requireUser(req), wallpaperFromUrlSchema.parse(req.body).url, { allowPrivate: deps.allowPrivateFetch === true }));
  app.delete('/api/v1/me/wallpaper/image', async (req, reply) => {
    await wallpaper.removeOwn(deps, requireUser(req).userId);
    return reply.code(204).send();
  });
  app.delete('/api/v1/admin/users/:id/avatar', async (req, reply) => {
    const admin = requireAdmin(req);
    await personal.removeAvatarAsAdmin(deps, admin, userId.parse(req.params).id, z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body).reason, ctxOf(deps, req).ipHash ?? undefined);
    return reply.code(204).send();
  });

  app.get('/api/v1/people', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({ q: z.string().trim().max(40).optional(), role: z.enum(['user', 'trusted', 'admin']).optional(), offset: z.coerce.number().int().min(0).max(10_000).optional() }).parse(req.query);
    return personal.directory(deps, requireUser(req), q);
  });
}
