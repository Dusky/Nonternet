import type { FastifyInstance } from 'fastify';
import { REPORT_CATEGORIES, mailBodySchema as body, mailStartSchema } from '@app/shared';
import { z } from 'zod';
import { ctxOf, requireUser } from '../http';
import type { AppDeps } from '../deps';
import * as mail from '../mail';

const threadId = z.object({ id: z.string().regex(/^mt_[0-9A-Z]{26}$/) });
const handle = z.string().trim().min(1).max(40);

// Private mail (docs/10). Everything here is for the signed-in person's own conversations only.
export function mailRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/mail', async (req) => {
    const o = z.object({
      q: z.string().max(80).optional(), unread: z.enum(['1', 'true']).optional().transform((v) => (v ? true : undefined)),
      before: z.string().regex(/^mt_[0-9A-Z]{26}$/).optional(), limit: z.coerce.number().int().min(1).max(50).optional(),
    }).parse(req.query);
    return mail.listThreads(deps, requireUser(req), o);
  });
  app.get('/api/v1/mail/unread', async (req) => ({ unread: await mail.unreadMail(deps, requireUser(req)) }));
  app.post('/api/v1/mail', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = mailStartSchema.parse(req.body);
    return reply.code(201).send(await mail.startThread(deps, requireUser(req), b));
  });
  app.get('/api/v1/mail/:id', async (req) => mail.readThread(deps, requireUser(req), threadId.parse(req.params).id));
  app.post('/api/v1/mail/:id/messages', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) =>
    reply.code(201).send(await mail.reply(deps, requireUser(req), threadId.parse(req.params).id, z.object({ body }).parse(req.body).body)));
  app.post('/api/v1/mail/:id/people', async (req, reply) => {
    await mail.addPerson(deps, requireUser(req), threadId.parse(req.params).id, z.object({ handle }).parse(req.body).handle);
    return reply.code(204).send();
  });
  app.post('/api/v1/mail/:id/leave', async (req, reply) => {
    await mail.leave(deps, requireUser(req), threadId.parse(req.params).id);
    return reply.code(204).send();
  });
  app.delete('/api/v1/mail/:id/messages/:mid', async (req, reply) => {
    const p = z.object({ id: z.string().regex(/^mt_[0-9A-Z]{26}$/), mid: z.string().regex(/^mm_[0-9A-Z]{26}$/) }).parse(req.params);
    await mail.deleteMessage(deps, requireUser(req), p.id, p.mid);
    return reply.code(204).send();
  });
  app.post('/api/v1/mail/:id/messages/:mid/report', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = z.object({ id: z.string().regex(/^mt_[0-9A-Z]{26}$/), mid: z.string().regex(/^mm_[0-9A-Z]{26}$/) }).parse(req.params);
    const b = z.object({ category: z.enum(REPORT_CATEGORIES), note: z.string().trim().max(500).default('') }).parse(req.body);
    return reply.code(201).send(await mail.reportMessage(deps, requireUser(req), p.id, p.mid, b.category, b.note, ctxOf(deps, req)));
  });

  app.get('/api/v1/me/blocks', async (req) => ({ blocks: await mail.listBlocks(deps, requireUser(req)) }));
  app.post('/api/v1/me/blocks', async (req, reply) => {
    await mail.block(deps, requireUser(req), z.object({ handle }).parse(req.body).handle);
    return reply.code(204).send();
  });
  app.post('/api/v1/me/blocks/remove', async (req, reply) => {
    await mail.unblock(deps, requireUser(req), z.object({ handle }).parse(req.body).handle);
    return reply.code(204).send();
  });
}
