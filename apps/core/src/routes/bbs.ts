import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireUser } from '../http';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { issueTicket } from '../irc/auth';
import * as bbs from '../bbs/service';
import { online } from '../presence-view';
import { ircOnline } from '../irc/sync';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const via = z.enum(['telnet', 'ssh', 'web']);
const node = z.number().int().min(1).max(10_000);
const handle = z.string().trim().min(1).max(40);

// The BBS (docs/04). /internal/bbs/* is for the BBS service only (bearer token from BBS_SECRET, never routed
// from outside); the rest is for signed-in people.
export function bbsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const fromBbs = (req: FastifyRequest) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!deps.bbs || !same(token, deps.bbs.authToken)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
  };
  const internal = { config: { rateLimit: false as const } };

  app.post('/internal/bbs/login', internal, async (req) => {
    fromBbs(req);
    const b = z.object({ method: z.enum(['password', 'ticket']), handle, secret: z.string().max(300), via, node, ip_hash: z.string().max(100).nullish() }).parse(req.body);
    return bbs.loginWithSecret(deps, { handle: b.handle, secret: b.secret, via: b.via, node: b.node, ip_hash: b.ip_hash });
  });
  app.post('/internal/bbs/login-key', internal, async (req) => {
    fromBbs(req);
    const b = z.object({ handle, fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/), node, ip_hash: z.string().max(100).nullish() }).parse(req.body);
    return bbs.loginWithKey(deps, b);
  });
  app.post('/internal/bbs/has-keys', internal, async (req) => {
    fromBbs(req);
    return { keys: await bbs.hasKeys(deps, z.object({ handle }).parse(req.body).handle) };
  });
  app.post('/internal/bbs/logout', internal, async (req, reply) => {
    fromBbs(req);
    const b = z.object({ token: z.string().max(200), call_id: z.string().max(40).optional() }).parse(req.body);
    await bbs.logout(deps, b.token, b.call_id);
    return reply.code(204).send();
  });
  app.post('/internal/bbs/nodes', internal, async (req) => {
    fromBbs(req);
    const b = z.object({ nodes: z.array(z.object({ node, token: z.string().max(200), via, where: z.string().max(200), since: z.string().max(40) })).max(1000) }).parse(req.body);
    return bbs.reportNodes(deps, b.nodes);
  });

  // The Terminal window asks for a one-use ticket and puts it in its WebSocket's first message (docs/04).
  app.post('/api/v1/bbs/ticket', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => issueTicket(deps, requireUser(req), 'bbs'));
  app.get('/api/v1/bbs/last-callers', async (req) => {
    const v = requireUser(req);
    if (v.role === 'guest') throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
    return { callers: await bbs.lastCallers(deps) };
  });

  // Who's online across the web, chat and the BBS (docs/10), for confirmed users.
  app.get('/api/v1/online', async (req) => {
    const v = requireUser(req);
    if (v.role === 'guest') throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
    const o = ircOnline();
    return { people: await online(deps), irc: o.accounts, at: o.at };
  });

  // SSH keys (Settings → Terminal).
  app.get('/api/v1/me/ssh-keys', async (req) => ({ keys: await bbs.listKeys(deps, requireUser(req).userId), max: bbs.MAX_KEYS }));
  app.post('/api/v1/me/ssh-keys', async (req, reply) => {
    const v = requireUser(req);
    if (v.role === 'guest') throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
    const b = z.object({ name: z.string().max(60).default(''), public_key: z.string().min(1).max(5000) }).parse(req.body);
    return reply.code(201).send(await bbs.addKey(deps, v.userId, b, ctxOf(deps, req)));
  });
  app.delete('/api/v1/me/ssh-keys/:id', async (req, reply) => {
    const v = requireUser(req);
    await bbs.removeKey(deps, v.userId, z.object({ id: z.string().regex(/^sk_[0-9A-Z]{26}$/) }).parse(req.params).id, ctxOf(deps, req));
    return reply.code(204).send();
  });
}
