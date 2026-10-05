import tls from 'node:tls';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { generate } from 'selfsigned';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from '../test/harness';
import { fingerprintOf, loadGeminiCert } from './cert';
import { buildGeminiServer, type GeminiServer } from './server';

// The Gemini mirror (docs/05): public things only, gemtext that user text can't break out of, and a certificate that
// is made once and kept, or the site's own, reloaded when renewed.
describe.skipIf(!dbAvailable)('gemini mirror', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let g: GeminiServer;
  let port = 0;
  let thread = '';
  const dataDir = mkdtempSync(join(tmpdir(), 'gemini-'));

  const ask = (line: string) => new Promise<{ head: string; body: string; cert: tls.PeerCertificate }>((resolve, reject) => {
    const s = tls.connect({ port, host: '127.0.0.1', servername: 'example.test', rejectUnauthorized: false });
    const chunks: Buffer[] = [];
    s.on('secureConnect', () => s.write(`${line}\r\n`));
    s.on('data', (c) => chunks.push(c));
    s.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const i = text.indexOf('\r\n');
      resolve({ head: text.slice(0, i), body: text.slice(i + 2), cert: s.getPeerCertificate() });
    });
    s.on('error', reject);
  });

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.config.limits.trusted_board_quota = 5;
    const owner = await makeUser(ctx, { role: 'trusted', handle: 'geminaut' });
    const c = await loginAs(ctx, owner.handle);
    await c.patch('/api/v1/me', { plan: '=> gemini://evil.example looks like a link\n# and a heading' });
    await c.post('/api/v1/boards', { slug: 'lobby', name: 'Lobby', visibility: 'public' });
    await c.post('/api/v1/boards', { slug: 'secret', name: 'Secret', visibility: 'private' });
    thread = (await c.post('/api/v1/boards/lobby/posts', { subject: 'Hello geminispace', body: 'First line.\n=> gemini://evil.example sneaky\n```' })).body.id;
    const cert = await loadGeminiCert(ctx.deps.config, { GEMINI_DATA_DIR: dataDir });
    g = buildGeminiServer(ctx.deps, cert);
    await new Promise<void>((r) => g.server.listen(0, '127.0.0.1', r));
    port = (g.server.address() as AddressInfo).port;
  });
  afterAll(async () => { g?.server.close(); await drop(); });

  it('serves the home page and public boards as gemtext, and nothing private', async () => {
    const home = await ask('gemini://example.test/');
    expect(home.head).toBe('20 text/gemini; lang=en');
    expect(home.body).toContain('# Test Site');
    expect(home.body).toContain('=> /boards/ Boards');
    const list = await ask('gemini://example.test/boards/');
    expect(list.body).toContain('=> /boards/lobby/ Lobby');
    expect(list.body).not.toContain('Secret');
    expect((await ask('gemini://example.test/boards/secret/')).head).toBe('51 Nothing here');
  });

  it('quotes posts and plans so nothing in them becomes a link or heading', async () => {
    const t = await ask(`gemini://example.test/boards/lobby/${thread}`);
    expect(t.body).toContain('# Hello geminispace');
    expect(t.body).toContain('> => gemini://evil.example sneaky');
    expect(t.body).toContain('> ```');
    expect(t.body).not.toMatch(/^=> gemini:\/\/evil/m);
    const p = await ask('gemini://example.test/~geminaut');
    expect(p.body).toContain('## Plan\n> => gemini://evil.example looks like a link\n> # and a heading');
    expect((await ask('gemini://example.test/~nobody')).head).toBe('51 Nothing here');
  });

  it('refuses other hosts, other schemes, junk and long requests', async () => {
    expect((await ask('gemini://elsewhere.example/')).head).toBe('53 This server only serves example.test');
    expect((await ask('https://example.test/')).head).toMatch(/^59 /);
    expect((await ask('not a url')).head).toMatch(/^59 /);
    expect((await ask(`gemini://example.test/${'a'.repeat(1100)}`)).head).toMatch(/^59 /);
  });

  it('makes its own certificate once and keeps it, and loads and reloads a given one', async () => {
    const first = await ask('gemini://example.test/');
    const again = await loadGeminiCert(ctx.deps.config, { GEMINI_DATA_DIR: dataDir });
    expect(`SHA256:${first.cert.fingerprint256}`).toBe(again.fingerprint);
    expect(first.cert.subject.CN).toBe('example.test');

    // The site's own certificate, from given paths (as compose.prod points into Caddy's store), and a renewed one.
    const site = await generate([{ name: 'commonName', value: 'example.test' }], { keyType: 'ec', curve: 'P-256' });
    const dir = mkdtempSync(join(tmpdir(), 'gemini-site-'));
    writeFileSync(join(dir, 'c.pem'), site.cert); writeFileSync(join(dir, 'k.pem'), site.private);
    const env = { GEMINI_TLS_CERT: join(dir, 'c.pem'), GEMINI_TLS_KEY: join(dir, 'k.pem') };
    const loaded = await loadGeminiCert({ ...ctx.deps.config, gemini: { ...ctx.deps.config.gemini, certificate: 'site' } }, env);
    expect(loaded).toMatchObject({ source: 'site', fingerprint: fingerprintOf(site.cert) });
    g.reload(loaded);
    expect(`SHA256:${(await ask('gemini://example.test/')).cert.fingerprint256}`).toBe(fingerprintOf(site.cert));
    await expect(loadGeminiCert({ ...ctx.deps.config, gemini: { ...ctx.deps.config.gemini, certificate: 'site' } }, {})).rejects.toThrow(/GEMINI_TLS_CERT/);
  });
});
