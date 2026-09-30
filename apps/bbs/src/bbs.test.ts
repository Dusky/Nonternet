import net, { type AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ssh2 from 'ssh2';
import WebSocket, { WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from '../../core/src/test/harness';
import { bbsSecrets } from '../../core/src/bbs/secrets';
import { ArtPack } from './art';
import { bbsAuthToken } from './config';
import { Core } from './core';
import { attachWs, fingerprintOf, sshServer, telnetServer } from './listeners';
import { hostKey } from './hostkey';
import { Nodes } from './nodes';
import type { BbsContext } from './session';

const SECRET = 's'.repeat(40);

// A caller's screen: everything received, as text, and a way to wait for something to appear.
class Screen {
  text = '';
  private waiters: { re: RegExp; resolve: () => void }[] = [];
  add(s: string) { this.text += s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''); for (const w of [...this.waiters]) if (w.re.test(this.text)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(); } }
  until(re: RegExp, ms = 5000): Promise<void> {
    if (re.test(this.text)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const w = { re, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error(`timed out waiting for ${re}; screen was:\n${this.text.slice(-2500)}`)), ms);
    });
  }
}

describe.skipIf(!dbAvailable)('the BBS', { timeout: 30_000 }, () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  let bbs: BbsContext;
  let telnetPort = 0, sshPort = 0, wsPort = 0;
  const servers: { close(cb?: () => void): unknown }[] = [];

  const person = async (terminal = 'terminal pass 1') => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: terminal });
    return { ...u, c };
  };

  // A telnet caller that answers the negotiation like a modern client (xterm, 100x30).
  const telnet = () => {
    const screen = new Screen();
    const s = net.connect(telnetPort, '127.0.0.1');
    s.on('data', (d: Buffer) => {
      const out: number[] = [];
      for (let i = 0; i < d.length; i++) {
        if (d[i] === 255 && d[i + 1] === 253 && d[i + 2] === 24) { s.write(Buffer.from([255, 251, 24])); i += 2; }
        else if (d[i] === 255 && d[i + 1] === 253 && d[i + 2] === 31) { s.write(Buffer.from([255, 251, 31, 255, 250, 31, 0, 100, 0, 30, 255, 240])); i += 2; }
        else if (d[i] === 255 && d[i + 1] === 250 && d[i + 2] === 24 && d[i + 3] === 1) { s.write(Buffer.from([255, 250, 24, 0, ...Buffer.from('XTERM'), 255, 240])); i += 5; }
        else if (d[i] === 255) i += 2;
        else out.push(d[i]!);
      }
      screen.add(Buffer.from(out).toString('utf8'));
    });
    return { s, screen, type: (x: string) => s.write(x) };
  };

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.bbs = bbsSecrets(SECRET);
    admin = await makeAdmin(ctx);
    const coreUrl = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    expect(bbsAuthToken(SECRET)).toBe(ctx.deps.bbs.authToken);
    const core = new Core(coreUrl, bbsAuthToken(SECRET), 'https://example.test');
    const nodes = new Nodes(4, 3);
    bbs = { core, art: new ArtPack(join(__dirname, '../art/default'), { 'site.name': 'Test Site', 'site.domain': 'example.test', 'site.url': 'https://example.test' }), nodes, secret: SECRET, siteUrl: 'https://example.test', log: () => undefined };
    nodes.start(core, 500);
    const tl = telnetServer(bbs, { idleMs: 60_000, negotiateMs: 300 });
    await new Promise<void>((r) => tl.listen(0, '127.0.0.1', r));
    telnetPort = (tl.address() as AddressInfo).port;
    const sh = sshServer(bbs, hostKey(join(mkdtempSync(join(tmpdir(), 'bbs-key-')), 'host')), { idleMs: 60_000 });
    await new Promise<void>((r) => sh.listen(0, '127.0.0.1', r));
    sshPort = (sh.address() as AddressInfo).port;
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => wss.on('listening', r));
    attachWs(wss, bbs, { idleMs: 60_000, trustProxy: () => false });
    wsPort = (wss.address() as AddressInfo).port;
    servers.push(tl, sh, wss);
  });
  afterAll(async () => { bbs?.nodes.stop(); for (const s of servers) s.close(); await ctx.app.close(); await drop(); });

  it('negotiates, shows the login screen with the site name from config, and signs in by telnet', async () => {
    const u = await person();
    const { s, screen, type } = telnet();
    await screen.until(/Handle:/);
    expect(screen.text).toContain('Test Site');
    expect(screen.text).toMatch(/node \d/);
    type(`${u.handle}\r`);
    await screen.until(/Terminal password:/);
    type('wrong\r');
    await screen.until(/do not match/);
    await screen.until(/Handle:.*$/s);
    type(`${u.handle}\rterminal pass 1\r`);
    await screen.until(/Main menu \[/);
    expect(screen.text).not.toContain('terminal pass 1'); // passwords are never echoed
    expect(screen.text).toContain('this is your first call');
    type('w');
    await screen.until(new RegExp(`\\d+\\s+${u.handle}\\s+.*\\(telnet\\)`));
    type('g');
    await screen.until(/Thanks for calling Test Site/);
    await new Promise((r) => s.on('close', r));
  });

  it('drops a caller within seconds of being suspended', async () => {
    const u = await person();
    const { s, screen, type } = telnet();
    await screen.until(/Handle:/);
    type(`${u.handle}\rterminal pass 1\r`);
    await screen.until(/Main menu \[/);
    const t0 = Date.now();
    await admin.client.post(`/api/v1/admin/users/${u.id}/suspend`, { reason: 'test' });
    await screen.until(/Your session has ended/, 5000);
    expect(Date.now() - t0).toBeLessThan(5000);
    await new Promise((r) => s.on('close', r));
  });

  it('signs in over SSH with the terminal password, or with a key registered on the web', async () => {
    const u = await person();
    const shell = (cfg: ssh2.ConnectConfig) => new Promise<{ screen: Screen; conn: ssh2.Client; stream: ssh2.ClientChannel }>((resolve, reject) => {
      const conn = new ssh2.Client();
      conn.on('ready', () => conn.shell({ term: 'xterm-256color', cols: 90, rows: 30 }, (err, stream) => {
        if (err) return reject(err);
        const screen = new Screen();
        stream.on('data', (d: Buffer) => screen.add(d.toString('utf8')));
        resolve({ screen, conn, stream });
      })).on('error', reject).connect({ host: '127.0.0.1', port: sshPort, username: u.handle, readyTimeout: 5000, tryKeyboard: false, ...cfg });
    });
    await expect(shell({ password: 'wrong' })).rejects.toThrow(/authentication/i);
    const a = await shell({ password: 'terminal pass 1' });
    await a.screen.until(/Main menu \[/);
    a.stream.write('g');
    await a.screen.until(/Thanks for calling/);
    a.conn.end();

    const { private: priv, public: pub } = ssh2.utils.generateKeyPairSync('ed25519', { comment: 'laptop' });
    const added = await u.c.post('/api/v1/me/ssh-keys', { public_key: pub });
    const parsed = ssh2.utils.parseKey(pub);
    expect(added.body.fingerprint).toBe(fingerprintOf((parsed as ssh2.ParsedKey).getPublicSSH())); // core and ssh2 agree
    const b = await shell({ privateKey: priv });
    await b.screen.until(/Main menu \[/);
    b.conn.end();
    const other = ssh2.utils.generateKeyPairSync('ed25519');
    await expect(shell({ privateKey: other.private })).rejects.toThrow(/authentication/i);
  });

  it('lets the web Terminal in with a one-use ticket and no prompt, and refuses it twice', async () => {
    const u = await person();
    const ticket = (await u.c.post('/api/v1/bbs/ticket')).body.ticket;
    const open = (tk: string) => {
      const screen = new Screen();
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      ws.on('message', (m) => screen.add(String(m)));
      ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', handle: u.handle, ticket: tk, cols: 100, rows: 30 })));
      return { ws, screen };
    };
    const a = open(ticket);
    await a.screen.until(/Main menu \[/);
    expect(a.screen.text).not.toContain('Handle:');
    a.ws.send(JSON.stringify({ t: 'in', d: 'l' }));
    await a.screen.until(new RegExp(`${u.handle}\\s+\\d+\\s+web on now`));
    a.ws.close();
    const b = open(ticket);
    await b.screen.until(/expired or was already used/);
  });

  it('limits callers per address', async () => {
    const callers = [telnet(), telnet(), telnet()];
    await Promise.all(callers.map((c) => c.screen.until(/Handle:/)));
    const fourth = telnet();
    await fourth.screen.until(/Too many connections from your address/);
    for (const c of callers) c.s.destroy();
  });
});
