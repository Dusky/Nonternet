import { buildApp } from './app';
import { loadSiteConfig } from './config';

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

let config;
try {
  config = loadSiteConfig();
} catch (err) {
  fail(err);
}

const app = buildApp(config);
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch(fail);
