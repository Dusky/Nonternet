import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { passwordSchema } from '@app/shared';
import { z } from 'zod';
import { ctxOf, requireAdmin, requireUser } from '../http';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import * as ircAuth from '../irc/auth';
import * as channels from '../irc/channels';
import * as ircAdmin from '../irc/admin';
import { ircOnline } from '../irc/sync';

const reason = z.string().trim().min(3, 'give a reason (at least 3 characters)').max(300);
const nick = z.string().regex(/^[A-Za-z0-9_\-\[\]\\^{}|`]{1,32}$/, 'not a nick');
// An IP address or network in CIDR form; UBAN treats anything else as a mask or account.
const address = z.string().trim().regex(/^([0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9a-f:]+:[0-9a-f:]*)(\/[0-9]{1,3})?$/i, 'an IP address or network, like 192.0.2.4 or 192.0.2.0/24');

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function ircRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Ergo's auth-script. Not under /api, so Caddy never routes it from outside; it also needs the token.
  app.post('/internal/irc/auth', { config: { rateLimit: false } }, async (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!deps.irc || !same(token, deps.irc.secrets.authToken)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
    const b = (req.body ?? {}) as { accountName?: unknown; passphrase?: unknown };
    return ircAuth.checkIrcLogin(deps, b.accountName, b.passphrase);
  });

  // The Chat app asks for a one-use ticket, then presents it to Ergo as its SASL password.
  app.post('/api/v1/irc/ticket', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => ircAuth.issueTicket(deps, requireUser(req)));

  app.get('/api/v1/irc/channels', async (req) => { requireUser(req); return { channels: await channels.listChannels(deps) }; });
  app.post('/api/v1/irc/channels', async (req, reply) => {
    const who = requireUser(req);
    const b = z.object({ name: z.string().max(40) }).parse(req.body);
    return reply.code(201).send(await channels.registerChannel(deps, who, b.name, ctxOf(deps, req)));
  });
  app.post('/api/v1/irc/channels/remove', async (req, reply) => {
    const who = requireUser(req);
    const b = z.object({ name: z.string().max(40), reason: reason.optional() }).parse(req.body);
    await channels.removeChannel(deps, who, b.name, ctxOf(deps, req), b.reason);
    return reply.code(204).send();
  });
  // Who is on IRC right now (docs/08), by handle.

  app.get('/api/v1/admin/irc', async (req) => { requireAdmin(req); return ircAdmin.overview(deps); });
  app.post('/api/v1/admin/irc/channels', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ name: z.string().max(40), reason }).parse(req.body);
    return reply.code(201).send(await channels.registerOfficial(deps, who, b.name, b.reason, ctxOf(deps, req)));
  });
  app.post('/api/v1/admin/irc/disconnect', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ nick, reason }).parse(req.body);
    await ircAdmin.disconnect(deps, who, b.nick, b.reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.get('/api/v1/admin/irc/bans', async (req) => { requireAdmin(req); return { bans: await ircAdmin.listBans() }; });
  app.post('/api/v1/admin/irc/bans', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ target: address, duration: z.string().regex(/^[0-9]+[mhdw]$/, 'like 30m, 12h, 7d or 2w').optional(), reason }).parse(req.body);
    await ircAdmin.addBan(deps, who, b.target, b.duration, b.reason, ctxOf(deps, req));
    return reply.code(201).send();
  });
  app.post('/api/v1/admin/irc/bans/remove', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ target: address }).parse(req.body);
    await ircAdmin.removeBan(deps, who, b.target, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/admin/irc/sync', async (req) => { requireAdmin(req); return { report: await ircAdmin.syncNow() }; });

  app.get('/api/v1/me/terminal-password', async (req) => ircAuth.terminalPasswordState(deps, requireUser(req).userId));
  app.put('/api/v1/me/terminal-password', async (req, reply) => {
    const who = requireUser(req);
    const b = z.object({ password: z.string().min(1).max(200), terminal_password: passwordSchema }).parse(req.body);
    await ircAuth.setTerminalPassword(deps, who, b.password, b.terminal_password, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/me/terminal-password/remove', async (req, reply) => {
    const who = requireUser(req);
    const b = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    await ircAuth.clearTerminalPassword(deps, who, who.userId, ctxOf(deps, req), { password: b.password });
    return reply.code(204).send();
  });
  app.post('/api/v1/admin/users/:id/terminal-password/remove', async (req, reply) => {
    const who = requireAdmin(req);
    const { id } = z.object({ id: z.string().regex(/^u_[0-9A-Z]{26}$/) }).parse(req.params);
    const b = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    await ircAuth.clearTerminalPassword(deps, who, id, ctxOf(deps, req), { reason: b.reason });
    return reply.code(204).send();
  });
}
