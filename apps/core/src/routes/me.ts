import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as accounts from '../accounts';
import { ctxOf, requireUser } from '../http';
import type { AppDeps } from '../deps';

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'enter the 6-digit code') });

export function meRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/me', async (req) => ({ user: accounts.toMe(requireUser(req, { allowLimited: true })) }));

  // TOTP setup is open to limited sessions: it is how an admin gets out of that state.
  app.post('/api/v1/me/totp/setup', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) =>
    accounts.totpSetup(deps, requireUser(req, { allowLimited: true })));

  app.post('/api/v1/me/totp/enable', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const { code } = codeSchema.parse(req.body);
    await accounts.totpEnable(deps, requireUser(req, { allowLimited: true }), code, ctxOf(deps, req));
    return reply.code(204).send();
  });
}
