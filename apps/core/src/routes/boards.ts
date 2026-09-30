import type { FastifyInstance } from 'fastify';
import { notificationsReadSchema, boardCreateSchema, boardUpdateSchema, categoryCreateSchema, memberAddSchema, postCreateSchema, readPointerSchema, slugSchema } from '@app/shared';
import { z } from 'zod';
import * as boards from '../boards';
import * as notifications from '../notifications';
import { ctxOf, requireAdmin, requireUser } from '../http';
import { previewPost } from '../text';
import type { AppDeps } from '../deps';

const slugParam = z.object({ slug: slugSchema });
const threadParams = slugParam.extend({ id: z.string().regex(/^p_[0-9A-Z]{26}$/, 'not a thread ID') });
const memberParams = slugParam.extend({ userId: z.string().regex(/^u_[0-9A-Z]{26}$/) });
const cursor = z.coerce.number().int().positive().optional();
const limit = z.coerce.number().int().min(1).max(500).optional();

export function boardRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Reading works logged out; what you see depends on who you are.
  const viewer = (req: Parameters<typeof boards.viewerOf>[0] extends infer S ? { session: S } : never) => boards.viewerOf(req.session);

  app.get('/api/v1/boards', async (req) => boards.listBoards(deps, viewer(req)));

  app.post('/api/v1/boards', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) =>
    reply.code(201).send(await boards.createBoard(deps, requireUser(req), boardCreateSchema.parse(req.body), ctxOf(deps, req))));

  app.get('/api/v1/boards/:slug', async (req) => boards.getBoard(deps, viewer(req), slugParam.parse(req.params).slug));

  app.patch('/api/v1/boards/:slug', async (req) =>
    boards.updateBoard(deps, requireUser(req), slugParam.parse(req.params).slug, boardUpdateSchema.parse(req.body), ctxOf(deps, req)));

  app.get('/api/v1/boards/:slug/threads', async (req) => {
    const q = z.object({ before: cursor, limit }).parse(req.query);
    return boards.listThreads(deps, viewer(req), slugParam.parse(req.params).slug, q);
  });

  app.get('/api/v1/boards/:slug/new', async (req) => boards.newPosts(deps, requireUser(req), slugParam.parse(req.params).slug, z.object({ after: cursor, limit }).parse(req.query)));

  app.get('/api/v1/boards/:slug/threads/:id', async (req) => {
    const p = threadParams.parse(req.params);
    return boards.getThread(deps, viewer(req), p.slug, p.id, z.object({ after: cursor, limit }).parse(req.query));
  });

  app.post('/api/v1/boards/:slug/posts', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) =>
    reply.code(201).send(await boards.createPost(deps, requireUser(req), slugParam.parse(req.params).slug, postCreateSchema.parse(req.body))));

  // The preview is computed by the server, so it is exactly what the terminal BBS will show.
  app.post('/api/v1/boards/:slug/posts/preview', async (req) => {
    requireUser(req);
    return previewPost(postCreateSchema.pick({ body: true }).parse(req.body).body);
  });

  app.delete('/api/v1/posts/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^p_[0-9A-Z]{26}$/, 'not a post ID') }).parse(req.params);
    await boards.deletePost(deps, requireUser(req), id, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.put('/api/v1/boards/:slug/read-pointer', async (req, reply) => {
    await boards.setReadPointer(deps, requireUser(req), slugParam.parse(req.params).slug, readPointerSchema.parse(req.body));
    return reply.code(204).send();
  });

  app.put('/api/v1/boards/:slug/watch', async (req, reply) => {
    await boards.setWatching(deps, requireUser(req), slugParam.parse(req.params).slug, true);
    return reply.code(204).send();
  });
  app.delete('/api/v1/boards/:slug/watch', async (req, reply) => {
    await boards.setWatching(deps, requireUser(req), slugParam.parse(req.params).slug, false);
    return reply.code(204).send();
  });

  app.get('/api/v1/boards/:slug/members', async (req) => ({ members: await boards.listMembers(deps, requireUser(req), slugParam.parse(req.params).slug) }));
  app.post('/api/v1/boards/:slug/members', async (req, reply) => {
    await boards.addMember(deps, requireUser(req), slugParam.parse(req.params).slug, memberAddSchema.parse(req.body).handle, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.delete('/api/v1/boards/:slug/members/:userId', async (req, reply) => {
    const p = memberParams.parse(req.params);
    await boards.removeMember(deps, requireUser(req), p.slug, p.userId, ctxOf(deps, req));
    return reply.code(204).send();
  });

  app.get('/api/v1/search', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const q = z.object({
      q: z.string().trim().min(2, 'search for at least 2 characters').max(200), board: slugSchema.optional(),
      offset: z.coerce.number().int().min(0).max(1000).optional(), limit: z.coerce.number().int().min(1).max(50).optional(),
    }).parse(req.query);
    return boards.search(deps, viewer(req), q.q, q);
  });

  app.post('/api/v1/admin/board-categories', async (req, reply) =>
    reply.code(201).send(await boards.createCategory(deps, requireAdmin(req), categoryCreateSchema.parse(req.body).name, ctxOf(deps, req))));

  app.get('/api/v1/notifications', async (req) =>
    notifications.listNotifications(deps, requireUser(req), z.object({ before: z.string().regex(/^n_[0-9A-Z]{26}$/).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(req.query)));
  app.get('/api/v1/notifications/count', async (req) => ({ unread: await notifications.unreadCount(deps, requireUser(req)) }));
  app.post('/api/v1/notifications/read', async (req, reply) => {
    await notifications.markRead(deps, requireUser(req), notificationsReadSchema.parse(req.body));
    return reply.code(204).send();
  });
}
