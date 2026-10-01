import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps';
import { landing } from '../landing';

// The logged-out front page (docs/10). Public; nothing in it is private. Cached briefly so a busy
// front page doesn't run the queries for every visitor.
let cache: { at: number; body: Awaited<ReturnType<typeof landing>> } | null = null;

// A new public thread (or a deletion) should show on the front page at once, not up to 30 seconds later.
export function dropLandingCache(): void { cache = null; }

export function landingRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/v1/landing', async (_req, reply) => {
    const now = Date.now();
    if (!cache || now - cache.at > 30_000) cache = { at: now, body: await landing(deps) };
    reply.header('cache-control', 'public, max-age=30');
    return cache.body;
  });
}
