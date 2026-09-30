import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteConfig } from '@app/shared';
import { renderErgoConfig } from '../irc/render';
import { ircSecrets, type IrcDeps } from '../irc/secrets';

// IRC tests run against a real Ergo (docs/08). Set ERGO_BIN, or have `ergo` on the PATH. CI sets
// REQUIRE_ERGO so a missing binary fails the run instead of skipping.
const found = process.env.ERGO_BIN ?? spawnSync('sh', ['-c', 'command -v ergo'], { encoding: 'utf8' }).stdout.trim();
export const ERGO_BIN = found || undefined;
export const ergoAvailable = Boolean(ERGO_BIN);
// Persistent history needs an Ergo built with PostgreSQL support (the official image is; some release
// binaries aren't). CI sets REQUIRE_ERGO_HISTORY.
export const ergoHasPostgres = ergoAvailable && (() => {
  const dir = mkdtempSync(join(tmpdir(), 'ergo-pg-'));
  const conf = join(dir, 'c.yaml');
  const def = spawnSync(ERGO_BIN!, ['defaultconfig'], { encoding: 'utf8' }).stdout.replace('    postgresql:\n        enabled: false', '    postgresql:\n        enabled: true');
  writeFileSync(conf, def);
  const r = spawnSync(ERGO_BIN!, ['initdb', '--conf', conf], { cwd: dir, encoding: 'utf8' });
  return !/not built with PostgreSQL support/.test(`${r.stdout}${r.stderr}`);
})();
if (!ergoHasPostgres && process.env.REQUIRE_ERGO_HISTORY) throw new Error('REQUIRE_ERGO_HISTORY is set but this ergo has no PostgreSQL support');
if (!ergoAvailable && process.env.REQUIRE_ERGO) throw new Error('REQUIRE_ERGO is set but no ergo binary was found');
export const AUTH_SCRIPT = fileURLToPath(new URL('../../../../services/irc/auth.sh', import.meta.url));

export async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
  });
}

async function waitForPort(port: number, ms = 10_000): Promise<void> {
  const { connect } = await import('node:net');
  const end = Date.now() + ms;
  for (;;) {
    const ok = await new Promise<boolean>((r) => { const c = connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
    if (ok) return;
    if (Date.now() > end) throw new Error(`ergo did not listen on ${port}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export interface RunningErgo { irc: IrcDeps; wsPort: number; stop(): Promise<void>; log: string[] }

export async function startErgo(config: SiteConfig, opts: { coreUrl: string; secret?: string; origins?: string[]; historyDatabaseUrl?: string }): Promise<RunningErgo> {
  const dir = mkdtempSync(join(tmpdir(), 'ergo-test-'));
  const secret = opts.secret ?? `test-secret-${Math.random().toString(36).slice(2)}-${'x'.repeat(24)}`;
  const secrets = ircSecrets(secret);
  const [port, wsPort, apiPort] = [await freePort(), await freePort(), await freePort()];
  const conf = join(dir, 'ircd.yaml');
  writeFileSync(conf, renderErgoConfig(config, {
    secrets, coreUrl: opts.coreUrl, authScript: AUTH_SCRIPT,
    plainListen: `127.0.0.1:${port}`, websocketListen: `127.0.0.1:${wsPort}`, apiListen: `127.0.0.1:${apiPort}`,
    websocketOrigins: opts.origins ?? ['https://example.test'], datastore: join(dir, 'ircd.db'), historyDatabaseUrl: opts.historyDatabaseUrl,
  }));
  const init = spawnSync(ERGO_BIN!, ['initdb', '--conf', conf], { cwd: dir, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`ergo initdb failed: ${init.stderr}`);
  const log: string[] = [];
  const child: ChildProcess = spawn(ERGO_BIN!, ['run', '--conf', conf], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr!.on('data', (d: Buffer) => log.push(d.toString()));
  child.stdout!.on('data', (d: Buffer) => log.push(d.toString()));
  await waitForPort(port);
  await waitForPort(apiPort);
  return {
    irc: { secrets, host: '127.0.0.1', port, apiUrl: `http://127.0.0.1:${apiPort}` },
    wsPort,
    log,
    stop: () => new Promise((r) => { child.once('exit', () => r()); child.kill('SIGTERM'); }),
  };
}

// A native-client login over plain TCP, the way a person's IRC client would do it.
export async function ircLogin(irc: IrcDeps, nick: string, password: string): Promise<{ ok: true; client: IrcClientLike } | { ok: false; reason: string }> {
  const { Client } = await import('irc-framework');
  const client = new Client() as unknown as IrcClientLike;
  return new Promise((done) => {
    const timer = setTimeout(() => { client.quit(); done({ ok: false, reason: 'timeout' }); }, 8000);
    client.on('registered', () => { clearTimeout(timer); done({ ok: true, client }); });
    client.on('irc error', (e: { reason?: string; error?: string }) => { if (e.error === 'sasl_fail' || /SASL/i.test(e.reason ?? '')) { clearTimeout(timer); client.quit(); done({ ok: false, reason: e.reason ?? e.error ?? 'error' }); } });
    client.on('close', () => { clearTimeout(timer); done({ ok: false, reason: 'closed' }); });
    client.connect({ host: irc.host, port: irc.port, nick, username: nick, gecos: nick, account: { account: nick, password }, auto_reconnect: false });
  });
}
export interface IrcClientLike {
  on(event: string, fn: (...args: any[]) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  connect(o: object): void; quit(msg?: string): void; raw(line: string): void; join(ch: string): void; say(target: string, msg: string): void;
  user: { nick: string }; connected: boolean;
}
