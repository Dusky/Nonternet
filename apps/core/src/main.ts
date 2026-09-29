import { buildApp } from './app';
import { depsFromEnv } from './env';
import { migrate } from './migrate';

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

async function start() {
  const deps = depsFromEnv();
  await migrate(deps.db, console.log);
  const app = await buildApp(deps);
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}

start().catch(fail);
