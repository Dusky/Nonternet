import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../http';
import { mudStatus } from '../mud/sync';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { issueTicket } from '../irc/auth';
import { checkMudLogin } from '../mud/auth';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function mudRoutes(app: FastifyInstance, deps: AppDeps): void {
  // The MUD's login backend. Not under /api, so Caddy never routes it from outside; it also needs the token.
  app.post('/internal/mud/auth', { config: { rateLimit: false } }, async (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!deps.mud || !same(token, deps.mud.secrets.authToken)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
    const b = (req.body ?? {}) as { accountName?: unknown; passphrase?: unknown };
    return checkMudLogin(deps, b.accountName, b.passphrase);
  });
  // The MUD window asks for a one-use ticket and sends `connect <handle> <ticket>` over its WebSocket.
  // The console's MUD page (docs/11): who is playing and where, and how big the world is.
  app.get('/api/v1/admin/mud', async (req) => {
    requireAdmin(req);
    if (!deps.mud) return { configured: false, reachable: false, status: null };
    try { return { configured: true, reachable: true, status: await mudStatus(deps) }; } catch { return { configured: true, reachable: false, status: null }; }
  });
  app.post('/api/v1/mud/ticket', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => issueTicket(deps, requireUser(req), 'mud'));
}
