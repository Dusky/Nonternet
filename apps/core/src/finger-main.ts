import { depsFromEnv } from './env';
import { buildFingerServer } from './finger/server';

// The finger server (docs/05), its own process beside core. It only reads the database.
async function start() {
  const deps = depsFromEnv();
  const server = buildFingerServer(deps, (m) => console.error(m));
  const shutdown = () => { server.close(() => void deps.db.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const port = Number(process.env.FINGER_LISTEN_PORT ?? 7979);
  server.listen(port, '0.0.0.0', () => console.log(`finger listening on ${port}`));
}
start().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
