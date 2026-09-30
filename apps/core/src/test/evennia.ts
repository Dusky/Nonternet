import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './ergo';

// MUD tests run against a real Evennia (docs/09). Set EVENNIA_BIN to the `evennia` launcher in a
// virtualenv with services/mud/requirements.txt installed, or have it on the PATH. CI sets REQUIRE_EVENNIA.
const found = process.env.EVENNIA_BIN ?? spawnSync('sh', ['-c', 'command -v evennia'], { encoding: 'utf8' }).stdout.trim();
export const EVENNIA_BIN = found || undefined;
export const evenniaAvailable = Boolean(EVENNIA_BIN);
if (!evenniaAvailable && process.env.REQUIRE_EVENNIA) throw new Error('REQUIRE_EVENNIA is set but no evennia launcher was found');
const GAME = fileURLToPath(new URL('../../../../services/mud', import.meta.url));

export interface RunningMud { url: string; wsPort: number; telnetPort: number; stop(): Promise<void> }

export async function startEvennia(opts: { coreUrl: string; secret: string; siteYaml: string }): Promise<RunningMud> {
  const dir = mkdtempSync(join(tmpdir(), 'mud-test-'));
  const game = join(dir, 'game');
  cpSync(GAME, game, { recursive: true, filter: (p) => !/__pycache__|\.db3$|server\/logs\/.+\.log/.test(p) });
  writeFileSync(join(dir, 'site.yaml'), opts.siteYaml);
  const [telnet, web, webInt, ws, amp] = [await freePort(), await freePort(), await freePort(), await freePort(), await freePort()];
  const env = {
    ...process.env,
    PATH: `${dirname(EVENNIA_BIN!)}:${process.env.PATH}`,
    SITE_CONFIG: join(dir, 'site.yaml'), MUD_SECRET: opts.secret, CORE_URL: opts.coreUrl,
    MUD_TELNET_PORT: String(telnet), MUD_WEB_PORT: String(web), MUD_WEB_INTERNAL_PORT: String(webInt), MUD_WS_PORT: String(ws), MUD_AMP_PORT: String(amp),
    MUD_LOGIN_THROTTLE_LIMIT: '1000', // every test login comes from 127.0.0.1
    EVENNIA_SUPERUSER_USERNAME: 'sitebot', EVENNIA_SUPERUSER_PASSWORD: `unused-${Math.random().toString(36).slice(2)}-password`, EVENNIA_SUPERUSER_EMAIL: '',
  };
  const run = (args: string[]) => {
    const r = spawnSync(EVENNIA_BIN!, args, { cwd: game, env, encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw new Error(`evennia ${args.join(' ')} failed: ${r.stdout}\n${r.stderr}`);
  };
  run(['migrate']);
  run(['start']);
  const url = `http://127.0.0.1:${web}`;
  const end = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`${url}/internal/status`)).status === 403) break; } catch { /* not up yet */ }
    if (Date.now() > end) throw new Error('evennia did not start');
    await new Promise((r) => setTimeout(r, 250));
  }
  return {
    url, wsPort: ws, telnetPort: telnet,
    stop: async () => { spawnSync(EVENNIA_BIN!, ['stop'], { cwd: game, env, timeout: 60_000 }); if (process.env.KEEP_MUD) console.log('MUD dir', dir); else rmSync(dir, { recursive: true, force: true }); },
  };
}

// The MUD window's way in: Evennia's WebSocket, JSON frames, raw markup.
export async function mudConnect(wsPort: number, handle: string, password: string): Promise<{ ok: boolean; texts: string[]; closed: () => boolean; send: (t: string) => void; close: () => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/`);
  const texts: string[] = [];
  let closed = false;
  let loggedIn = false;
  ws.onmessage = (e) => {
    const [cmd, args] = JSON.parse(String(e.data)) as [string, unknown[]];
    if (cmd === 'logged_in') loggedIn = true;
    if (cmd === 'text') texts.push(String(args[0]));
  };
  ws.onclose = () => { closed = true; };
  await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error('websocket failed')); });
  // Evennia drops input sent before its session is set up; the welcome screen says it is ready.
  const ready = Date.now() + 8000;
  while (texts.length === 0 && Date.now() < ready) await new Promise((r) => setTimeout(r, 20));
  ws.send(JSON.stringify(['client_options', [], { raw: true }]));
  ws.send(JSON.stringify(['text', [`connect ${handle} ${password}`], {}]));
  const end = Date.now() + 8000;
  while (!loggedIn && Date.now() < end && !texts.some((t) => /incorrect/i.test(t))) await new Promise((r) => setTimeout(r, 50));
  return { ok: loggedIn, texts, closed: () => closed, send: (t) => ws.send(JSON.stringify(['text', [t], {}])), close: () => ws.close() };
}
