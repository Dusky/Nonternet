import { buildHomesApp } from './homes/server';
import { depsFromEnv } from './env';

async function start() {
  const deps = depsFromEnv();
  const app = await buildHomesApp(deps);
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await deps.db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  await app.listen({ port: Number(process.env.HOMES_PORT ?? 3100), host: '0.0.0.0' });
}
start().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
