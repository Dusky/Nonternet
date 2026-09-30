import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../http';
import { mudStatus } from '../mud/sync';
import { z } from 'zod';
import { ctxOf } from '../http';
import { grantOp, revokeOp } from '../admin';
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
  // Builders (docs/18): an op of the MUD. Appointed by admins; each change is audited and reaches the MUD at once.
  app.get('/api/v1/admin/mud/builders', async (req) => {
    requireAdmin(req);
    const r = await deps.db.query<{ op_id: string; user_id: string; handle: string; created_at: Date }>(
      `SELECT s.id AS op_id, u.id AS user_id, u.handle, s.created_at FROM scoped_roles s JOIN users u ON u.id = s.user_id
       WHERE s.role = 'mud_builder' AND s.scope_type = 'mud' ORDER BY u.handle`);
    return { builders: r.rows.map((b) => ({ op_id: b.op_id, user_id: b.user_id, handle: b.handle, since: b.created_at.toISOString() })) };
  });
  app.post('/api/v1/admin/mud/builders', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ handle: z.string().trim().min(1).max(40), reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const u = await deps.db.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1) AND status <> 'deleted'`, [b.handle]);
    if (!u.rows[0]) throw new ApiError(404, 'not_found', 'Nobody has that handle.');
    return reply.code(201).send(await grantOp(deps, who, u.rows[0].id, 'mud', 'world', b.reason, ctxOf(deps, req)));
  });
  app.post('/api/v1/admin/mud/builders/remove', async (req, reply) => {
    const who = requireAdmin(req);
    const b = z.object({ user_id: z.string().regex(/^u_[0-9A-Z]{26}$/), op_id: z.string().max(40), reason: z.string().trim().min(3).max(500) }).parse(req.body);
    await revokeOp(deps, who, b.user_id, b.op_id, b.reason, ctxOf(deps, req));
    return reply.code(204).send();
  });
  app.post('/api/v1/mud/ticket', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => issueTicket(deps, requireUser(req), 'mud'));
}
