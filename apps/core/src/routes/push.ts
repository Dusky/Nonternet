import type { FastifyInstance } from 'fastify';
import { pushSubscribeSchema, pushUpdateSchema } from '@app/shared';
import { requireUser } from '../http';
import * as push from '../push';
import type { AppDeps } from '../deps';

// Push notifications (docs/10, 14). The public key is public: a browser needs it to sign up.
export function pushRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/push', async () => ({ key: deps.push?.publicKey ?? null }));
  app.get('/api/v1/me/push', async (req) => ({ devices: await push.listDevices(deps, requireUser(req).userId) }));
  app.post('/api/v1/me/push', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) =>
    ({ device: await push.subscribe(deps, requireUser(req), pushSubscribeSchema.parse(req.body)) }));
  app.patch('/api/v1/me/push/:id', async (req, reply) => {
    await push.updateDevice(deps, requireUser(req), (req.params as { id: string }).id, pushUpdateSchema.parse(req.body).kinds);
    return reply.code(204).send();
  });
  app.delete('/api/v1/me/push/:id', async (req, reply) => {
    await push.removeDevice(deps, requireUser(req), (req.params as { id: string }).id);
    return reply.code(204).send();
  });
}
