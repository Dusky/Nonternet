import Fastify from 'fastify';
import { toPublicSite, type SiteConfig } from '@app/shared';

export function buildApp(config: SiteConfig) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.get('/healthz', async () => ({ status: 'ok' }));

  // Everything the shell needs to brand itself. The shell never hard-codes the name.
  app.get('/api/v1/site', async () => toPublicSite(config));

  return app;
}
