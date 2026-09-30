import { depsFromEnv } from './env';
import { buildGopherServer } from './gopher/server';

// The read-only Gopher mirror (docs/05), its own process beside core. It only reads the database.
async function start() {
  const deps = depsFromEnv();
  const server = buildGopherServer(deps, (m) => console.error(m));
  const shutdown = () => { server.close(() => void deps.db.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const port = Number(process.env.GOPHER_LISTEN_PORT ?? 7070);
  server.listen(port, '0.0.0.0', () => console.log(`gopher listening on ${port}`));
}
start().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
