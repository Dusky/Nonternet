import type { FastifyInstance } from 'fastify';
import { ctxOf, setSessionCookie } from '../http';
import type { AppDeps } from '../deps';
import * as setup from '../setup';

// The installer's web finish (docs/19): is setup still open, and creating the first admin with the setup link.
export function setupRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/setup', async () => setup.setupStatus(deps));
  app.post('/api/v1/setup', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { token } = await setup.finishSetup(deps, setup.setupInputSchema.parse(req.body), ctxOf(deps, req));
    setSessionCookie(deps, reply, token);
    return reply.code(201).send({ ok: true });
  });
}
