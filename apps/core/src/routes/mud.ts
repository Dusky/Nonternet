import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../http';
import { mudStatus, mudSyncSoon } from '../mud/sync';
import { z } from 'zod';
import { ctxOf } from '../http';
import { grantOp, revokeOp } from '../admin';
import { charactersOf, publicProfile, setFeatured, towerLeaderboard } from '../characters';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { issueTicket } from '../irc/auth';
import { checkMudLogin } from '../mud/auth';
import { audit } from '../audit';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function mudRoutes(app: FastifyInstance, deps: AppDeps): void {
  // The MUD's login backend. Not under /api, so Caddy never routes it from outside; it also needs the token.
  app.post('/internal/mud/auth', { config: { rateLimit: false } }, async (req) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!deps.mud || !same(token, deps.mud.secrets.authToken)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
    const b = (req.body ?? {}) as { accountName?: unknown; passphrase?: unknown };
    return checkMudLogin(deps, b.accountName, b.passphrase);
  });
  // The MUD says a character was made or changed; core refreshes its copy now (docs/09).
  app.post('/internal/mud/characters-changed', { config: { rateLimit: false } }, async (req, reply) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!deps.mud || !same(token, deps.mud.secrets.authToken)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
    mudSyncSoon();
    return reply.code(202).send();
  });
  // A builder or admin took something down in the game: the MUD tells core, which writes it to the audit log (docs/03).
  app.post('/internal/mud/audit', { config: { rateLimit: false } }, async (req, reply) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!deps.mud || !same(token, deps.mud.secrets.authToken)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
    const b = z.object({
      action: z.enum(['mud.note_removed', 'mud.guestbook_removed']),
      actor: z.string().regex(/^u_[0-9A-Z]{26}$/), target: z.string().regex(/^u_[0-9A-Z]{26}$/).nullable().default(null),
      text: z.string().max(400).default(''),
    }).parse(req.body);
    const known = await deps.db.query<{ id: string }>(`SELECT id FROM users WHERE id = ANY($1)`, [[b.actor, b.target].filter(Boolean)]);
    await audit(deps.db, {
      actorId: known.rows.some((u) => u.id === b.actor) ? b.actor : null, actorKind: 'user', action: b.action, targetType: 'user',
      targetId: b.target && known.rows.some((u) => u.id === b.target) ? b.target : undefined, after: { text: b.text }, origin: 'system',
    });
    return reply.code(204).send();
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
  // Characters for the rest of the site (docs/09): public profiles, and your own list and featured one.
  // The tower's leaderboard (docs/18), for anyone signed in.
  app.get('/api/v1/mud/leaderboard', async () => towerLeaderboard(deps));
  app.get('/api/v1/users/:handle', async (req) => publicProfile(deps, z.object({ handle: z.string().max(40) }).parse(req.params).handle));
  app.get('/api/v1/me/characters', async (req) => {
    const who = requireUser(req);
    const featured = (await deps.db.query<{ f: string | null }>(`SELECT featured_character_id AS f FROM users WHERE id = $1`, [who.userId])).rows[0]?.f ?? null;
    return { characters: await charactersOf(deps, who.userId), featured_character_id: featured };
  });
  app.put('/api/v1/me/featured-character', async (req, reply) => {
    const b = z.object({ character_id: z.string().regex(/^c_\d+$/).nullable() }).parse(req.body);
    await setFeatured(deps, requireUser(req), b.character_id);
    return reply.code(204).send();
  });

  app.post('/api/v1/mud/ticket', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => issueTicket(deps, requireUser(req), 'mud'));
}
