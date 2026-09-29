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

  // Returns the recovery codes. They are shown once and never again.
  app.post('/api/v1/me/totp/enable', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { code } = codeSchema.parse(req.body);
    return { recovery_codes: await accounts.totpEnable(deps, requireUser(req, { allowLimited: true }), code, ctxOf(deps, req)) };
  });

  // New set of recovery codes; the old ones stop working. Needs a current authenticator code.
  app.post('/api/v1/me/totp/recovery-codes', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { code } = codeSchema.parse(req.body);
    return { recovery_codes: await accounts.regenerateRecoveryCodes(deps, requireUser(req), code, ctxOf(deps, req)) };
  });
}
