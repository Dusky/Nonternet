import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Boots the real thing for the end-to-end tests: a fresh database, the built core, and the built
// shell served by `vite preview`, wired together the way Caddy wires them in production.
const here = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = resolve(here, '..', '..');
export const TMP = resolve(here, '..', '.tmp');
export const SHELL_PORT = Number(process.env.E2E_SHELL_PORT ?? 4373);
export const CORE_PORT = Number(process.env.E2E_CORE_PORT ?? 3373);
export const HOMES_PORT = Number(process.env.E2E_HOMES_PORT ?? 4374);
// Homepages live on subdomains of this. The browser is told to send them all to this machine.
export const HOMES_DOMAIN = 'e2e-homes.test';
export const BASE_URL = `http://127.0.0.1:${SHELL_PORT}`;
export const OIDC_CALLBACK = `${BASE_URL}/e2e-callback`;
export const SITE_NAME = 'E2E Test Site';
export const IRC_PORT = Number(process.env.E2E_IRC_PORT ?? 6373);
export const IRC_WS_PORT = Number(process.env.E2E_IRC_WS_PORT ?? 6374);
export const IRC_API_PORT = Number(process.env.E2E_IRC_API_PORT ?? 6375);
// The IRC tests need a real Ergo (ERGO_BIN or `ergo` on the PATH). CI sets REQUIRE_ERGO.
const ergoFound = process.env.ERGO_BIN ?? (() => { try { return execFileSync('sh', ['-c', 'command -v ergo'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
export const ERGO_BIN = ergoFound || undefined;
if (!ERGO_BIN && process.env.REQUIRE_ERGO) throw new Error('REQUIRE_ERGO is set but no ergo binary was found');
export const MUD_TELNET_PORT = Number(process.env.E2E_MUD_TELNET_PORT ?? 6470);
export const MUD_WEB_PORT = Number(process.env.E2E_MUD_WEB_PORT ?? 6471);
export const MUD_WS_PORT = Number(process.env.E2E_MUD_WS_PORT ?? 6472);
// The MUD tests need a real Evennia (EVENNIA_BIN, or `evennia` on the PATH). CI sets REQUIRE_EVENNIA.
const evenniaFound = process.env.EVENNIA_BIN ?? (() => { try { return execFileSync('sh', ['-c', 'command -v evennia'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
export const EVENNIA_BIN = evenniaFound || undefined;
if (!EVENNIA_BIN && process.env.REQUIRE_EVENNIA) throw new Error('REQUIRE_EVENNIA is set but no evennia launcher was found');

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
site: { name: ${SITE_NAME}, short_name: e2etest, domain: 127.0.0.1, homes_domain: ${HOMES_DOMAIN} }
signup: { mode: invite }
services: { irc: ${ERGO_BIN ? 'true' : 'false'}, mud: ${EVENNIA_BIN ? 'true' : 'false'} }
irc: { public_host: 127.0.0.1, public_port: ${IRC_PORT} }
mud: { public_host: 127.0.0.1, public_port: ${MUD_TELNET_PORT} }
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
    HOMES_DIR: join(TMP, 'homes'),
    HOMES_PUBLIC_PORT: String(HOMES_PORT),
    HOMES_PORT: String(HOMES_PORT),
    RATE_LIMIT: 'off', // the tests sign up far more people than one address may in an hour
    ...(process.env.TEST_REDIS_URL ? { REDIS_URL: process.env.TEST_REDIS_URL } : {}),
    ...(ERGO_BIN ? { IRC_SECRET: randomBytes(24).toString('base64url'), IRC_HOST: '127.0.0.1', IRC_PORT: String(IRC_PORT), IRC_API_URL: `http://127.0.0.1:${IRC_API_PORT}` } : {}),
    ...(EVENNIA_BIN ? { MUD_SECRET: randomBytes(24).toString('base64url'), MUD_URL: `http://127.0.0.1:${MUD_WEB_PORT}` } : {}),
  };
  writeFileSync(join(TMP, 'stack.json'), JSON.stringify({ SITE_CONFIG: env.SITE_CONFIG, DATABASE_URL: env.DATABASE_URL, APP_SECRET_KEY: env.APP_SECRET_KEY }));

  const procs: ChildProcess[] = [];
  const start = (name: string, cmd: string, args: string[], cwd: string, extra: Record<string, string> = {}) => {
    const out = createWriteStream(join(TMP, `${name}.log`), { flags: 'a' });
    const p = spawn(cmd, args, { cwd, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    // Both into one file; neither may end it, or the other's next line would write after the end.
    p.stdout!.pipe(out, { end: false });
    p.stderr!.pipe(out, { end: false });
    p.once('exit', () => out.end());
    procs.push(p);
    return p;
  };

  start('core', process.execPath, [coreBundle], join(ROOT, 'apps/core'));
  await waitFor(`http://127.0.0.1:${CORE_PORT}/healthz`, 'core', join(TMP, 'core.log'));
  if (ERGO_BIN) {
    // Ergo, configured by the same command an operator runs, then core's bot connects to it.
    mkdirSync(join(TMP, 'ircd'), { recursive: true });
    execFileSync(process.execPath, [join(ROOT, 'apps/core/dist/cli.cjs'), 'irc-config', '--out', join(TMP, 'ircd', 'ircd.yaml')], {
      env: { ...env, IRC_CORE_URL: `http://127.0.0.1:${CORE_PORT}`, IRC_AUTH_SCRIPT: join(ROOT, 'services/irc/auth.sh'),
        IRC_LISTEN: `127.0.0.1:${IRC_PORT}`, IRC_WS_LISTEN: `127.0.0.1:${IRC_WS_PORT}`, IRC_API_LISTEN: `127.0.0.1:${IRC_API_PORT}`, IRC_DATASTORE: join(TMP, 'ircd', 'ircd.db') },
    });
    execFileSync(ERGO_BIN, ['initdb', '--conf', 'ircd.yaml'], { cwd: join(TMP, 'ircd') });
    start('ergo', ERGO_BIN, ['run', '--conf', 'ircd.yaml'], join(TMP, 'ircd'));
  }
  let stopMud = () => undefined as unknown;
  if (EVENNIA_BIN) {
    // The MUD from services/mud, in a copy so its database and logs stay out of the repo.
    const game = join(TMP, 'mud');
    cpSync(join(ROOT, 'services/mud'), game, { recursive: true, filter: (p) => !/__pycache__|\.db3$/.test(p) });
    const mudEnv = {
      ...env, PATH: `${dirname(EVENNIA_BIN)}:${process.env.PATH}`, CORE_URL: `http://127.0.0.1:${CORE_PORT}`,
      MUD_TELNET_PORT: String(MUD_TELNET_PORT), MUD_WEB_PORT: String(MUD_WEB_PORT), MUD_WEB_INTERNAL_PORT: String(MUD_WEB_PORT + 10),
      MUD_WS_PORT: String(MUD_WS_PORT), MUD_AMP_PORT: String(MUD_WS_PORT + 10), MUD_LOGIN_THROTTLE_LIMIT: '1000',
      EVENNIA_SUPERUSER_USERNAME: 'sitebot', EVENNIA_SUPERUSER_PASSWORD: randomBytes(18).toString('base64url'), EVENNIA_SUPERUSER_EMAIL: '',
    };
    execFileSync(EVENNIA_BIN, ['migrate'], { cwd: game, env: mudEnv, stdio: 'ignore' });
    execFileSync(EVENNIA_BIN, ['start'], { cwd: game, env: mudEnv, stdio: 'ignore' });
    stopMud = () => { try { execFileSync(EVENNIA_BIN, ['stop'], { cwd: game, env: mudEnv, stdio: 'ignore', timeout: 60_000 }); } catch { /* already gone */ } };
    const end = Date.now() + 60_000;
    for (;;) { // the game server is ready once its internal API answers (it refuses without a token)
      try { if ((await fetch(`http://127.0.0.1:${MUD_WEB_PORT}/internal/status`)).status === 403) break; } catch { /* not up yet */ }
      if (Date.now() > end) throw new Error(`the MUD did not start. See ${join(game, 'server/logs')}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  start('homes', process.execPath, [join(ROOT, 'apps/core/dist/homes-main.cjs')], join(ROOT, 'apps/core'));
  await waitFor(`http://127.0.0.1:${HOMES_PORT}/healthz`, 'homes', join(TMP, 'homes.log'));
  start('shell', join(ROOT, 'apps/shell/node_modules/.bin/vite'), ['preview', '--host', '127.0.0.1', '--port', String(SHELL_PORT), '--strictPort'], join(ROOT, 'apps/shell'), { CORE_URL: `http://127.0.0.1:${CORE_PORT}`, IRC_WS_URL: `ws://127.0.0.1:${IRC_WS_PORT}`, MUD_WS_URL: `ws://127.0.0.1:${MUD_WS_PORT}` });
  await waitFor(`${BASE_URL}/`, 'shell', join(TMP, 'shell.log'));

  return async () => {
    for (const p of procs) p.kill('SIGTERM');
    stopMud();
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
