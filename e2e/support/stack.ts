import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Boots the real thing for the end-to-end tests: a fresh database, the built core, and the built
// shell served by `vite preview`, wired together the way Caddy wires them in production.
const here = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = resolve(here, '..', '..');
export const TMP = resolve(here, '..', '.tmp');
export const SHELL_PORT = Number(process.env.E2E_SHELL_PORT ?? 4373);
export const CORE_PORT = Number(process.env.E2E_CORE_PORT ?? 3373);
export const BASE_URL = `http://127.0.0.1:${SHELL_PORT}`;
export const OIDC_CALLBACK = `${BASE_URL}/e2e-callback`;
export const SITE_NAME = 'E2E Test Site';

async function waitFor(url: string, what: string, log: string): Promise<void> {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${what} did not start. See ${log}`);
}

export interface StackInfo { dbName: string; env: Record<string, string> }

export async function startStack(): Promise<() => Promise<void>> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error('Set TEST_DATABASE_URL (a Postgres you can create databases on) to run the end-to-end tests.');
  const coreBundle = join(ROOT, 'apps/core/dist/main.cjs');
  if (!existsSync(coreBundle) || !existsSync(join(ROOT, 'apps/shell/dist/index.html'))) throw new Error('Build first: pnpm build');

  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const dbName = `e2e_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;

  writeFileSync(join(TMP, 'site.yaml'), `
site: { name: ${SITE_NAME}, short_name: e2etest, domain: 127.0.0.1, homes_domain: e2e-homes.test }
signup: { mode: invite }
oidc:
  clients:
    - { client_id: e2e-app, redirect_uris: ["${OIDC_CALLBACK}"], public: true }
`);
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SITE_CONFIG: join(TMP, 'site.yaml'),
    DATABASE_URL: dbUrl.toString(),
    APP_SECRET_KEY: randomBytes(32).toString('base64'),
    PUBLIC_URL: BASE_URL,
    NODE_ENV: 'development',
    PORT: String(CORE_PORT),
    RATE_LIMIT: 'off', // the tests sign up far more people than one address may in an hour
    ...(process.env.TEST_REDIS_URL ? { REDIS_URL: process.env.TEST_REDIS_URL } : {}),
  };
  writeFileSync(join(TMP, 'stack.json'), JSON.stringify({ SITE_CONFIG: env.SITE_CONFIG, DATABASE_URL: env.DATABASE_URL, APP_SECRET_KEY: env.APP_SECRET_KEY }));

  const procs: ChildProcess[] = [];
  const start = (name: string, cmd: string, args: string[], cwd: string, extra: Record<string, string> = {}) => {
    const out = createWriteStream(join(TMP, `${name}.log`), { flags: 'a' });
    const p = spawn(cmd, args, { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout!.pipe(out);
    p.stderr!.pipe(out);
    procs.push(p);
    return p;
  };

  start('core', process.execPath, [coreBundle], join(ROOT, 'apps/core'));
  await waitFor(`http://127.0.0.1:${CORE_PORT}/healthz`, 'core', join(TMP, 'core.log'));
  start('shell', join(ROOT, 'apps/shell/node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(SHELL_PORT), '--strictPort'], join(ROOT, 'apps/shell'), { CORE_URL: `http://127.0.0.1:${CORE_PORT}` });
  await waitFor(`${BASE_URL}/`, 'shell', join(TMP, 'shell.log'));

  return async () => {
    for (const p of procs) p.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  };
}

// Operator command run against the same database, like an admin on the server would.
export function cli(args: string[], extraEnv: Record<string, string> = {}): string {
  const stack = JSON.parse(readFileSync(join(TMP, 'stack.json'), 'utf8')) as Record<string, string>;
  return execFileSync(process.execPath, [join(ROOT, 'apps/core/dist/cli.cjs'), ...args], {
    env: { ...process.env, ...stack, PUBLIC_URL: BASE_URL, NODE_ENV: 'development', ...extraEnv }, encoding: 'utf8',
  });
}
