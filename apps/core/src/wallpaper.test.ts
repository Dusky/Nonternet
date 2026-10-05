import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import sharp from 'sharp';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser, ORIGIN, TEST_PASSWORD } from './test/harness';
import { processNext } from './exports/service';
import { deleteAccount } from './deletion';
import { isPublicAddress, safeFetch } from './safe-fetch';

describe('which addresses a fetch may reach', () => {
  it('refuses private, loopback, link-local and special addresses, and allows public ones', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'not-an-ip']) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it('refuses a name or literal address that leads inside, and other schemes', async () => {
    await expect(safeFetch('http://127.0.0.1/', { maxBytes: 10 })).rejects.toThrow(/public internet/);
    await expect(safeFetch('http://localhost/', { maxBytes: 10 })).rejects.toThrow(/public internet/);
    await expect(safeFetch('http://[::1]/', { maxBytes: 10 })).rejects.toThrow(/public internet/);
    await expect(safeFetch('file:///etc/passwd', { maxBytes: 10 })).rejects.toThrow(/http and https/);
    await expect(safeFetch('http://user:pw@example.com/', { maxBytes: 10 })).rejects.toThrow(/name and password/);
  });
});

describe.skipIf(!dbAvailable)('desktop wallpaper', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: http.Server;
  let base = '';
  const picture = () => sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#2a6f6f' } }).jpeg().toBuffer();

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    const pic = await picture();
    // A small web server: a picture, a redirect to it, something that is not a picture, and something too big.
    server = http.createServer((req, res) => {
      if (req.url === '/hills.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(pic); return; }
      if (req.url === '/moved') { res.writeHead(302, { location: '/hills.jpg' }); res.end(); return; }
      if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>hello</html>'); return; }
      if (req.url === '/huge') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) }); res.end(); return; }
      res.writeHead(404); res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { server.close(); await drop(); });

  const put = (sid: string, body: Buffer) => ctx.app.inject({ method: 'PUT', url: '/api/v1/me/wallpaper/image', payload: body, headers: { origin: ORIGIN, cookie: `sid=${sid}`, 'content-type': 'application/octet-stream' } });

  it('starts on dots, takes a pattern or a preset, and refuses what the site does not have', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    expect((await c.get('/api/v1/me/wallpaper')).body).toEqual({ choice: 'dots', fit: 'cover', own: null });
    expect((await c.put('/api/v1/me/wallpaper', { choice: 'grid' })).body.choice).toBe('grid');
    expect((await c.put('/api/v1/me/wallpaper', { choice: 'preset:hillside', fit: 'cover' })).body).toMatchObject({ choice: 'preset:hillside' });
    expect((await c.put('/api/v1/me/wallpaper', { choice: 'preset:nope' })).status).toBe(400);
    expect((await c.put('/api/v1/me/wallpaper', { choice: 'own' })).body.error.code).toBe('no_picture');
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/me/wallpaper' })).statusCode).toBe(401);
  });

  it('keeps an uploaded picture as a WebP no wider than 2560, shown only to its owner, and removes it', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const r = await put(c.sid, await picture());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ choice: 'own', own: { source_url: null } });
    const img = await ctx.app.inject({ method: 'GET', url: '/api/v1/me/wallpaper/image', headers: { cookie: `sid=${c.sid}` } });
    expect(img.headers['content-type']).toBe('image/webp');
    expect((await sharp(img.rawPayload).metadata()).width).toBe(2560);
    const other = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/me/wallpaper/image', headers: { cookie: `sid=${other.sid}` } })).statusCode).toBe(404); // theirs, not hers
    expect((await put(c.sid, Buffer.from('<svg onload="x()"/>'))).json().error.code).toBe('bad_image');
    expect((await c.delete('/api/v1/me/wallpaper/image')).status).toBe(204);
    expect((await c.get('/api/v1/me/wallpaper')).body).toMatchObject({ choice: 'dots', own: null });
  });

  it('copies a picture from a web address once, following a redirect, and refuses pages, huge files and inside addresses', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    expect((await c.post('/api/v1/me/wallpaper/from-url', { url: `${base}/hills.jpg` })).body.error.code).toBe('fetch_refused'); // a local address, refused as on a real site
    ctx.deps.allowPrivateFetch = true;
    try {
      const r = await c.post('/api/v1/me/wallpaper/from-url', { url: `${base}/moved` });
      expect(r.body).toMatchObject({ choice: 'own', own: { source_url: `${base}/moved` } });
      expect((await c.post('/api/v1/me/wallpaper/from-url', { url: `${base}/page` })).body.error.code).toBe('bad_image');
      expect((await c.post('/api/v1/me/wallpaper/from-url', { url: `${base}/huge` })).body.error.code).toBe('too_big');
      expect((await c.post('/api/v1/me/wallpaper/from-url', { url: `${base}/missing` })).body.error.code).toBe('fetch_refused');
      expect((await c.post('/api/v1/me/wallpaper/from-url', { url: 'ftp://example.com/x.png' })).status).toBe(400);
    } finally { ctx.deps.allowPrivateFetch = false; }
  });

  it('is in the export, and goes with the account', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await put(c.sid, await picture());
    await c.put('/api/v1/me/wallpaper', { choice: 'own', fit: 'tile' });
    expect((await c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await ctx.deps.db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [u.id])).rows[0]!;
    const files = unzipSync(new Uint8Array(readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`))));
    expect(JSON.parse(strFromU8(files['settings.json']!)).wallpaper).toEqual({ choice: 'own', fit: 'tile', source_url: null });
    expect(files['wallpaper.webp']!.length).toBeGreaterThan(100);
    const path = join(ctx.deps.filesDir, 'wallpapers', `${u.id}.webp`);
    expect(existsSync(path)).toBe(true);
    await deleteAccount(ctx.deps, u.id, { posts: 'keep', actor: null }, {});
    expect(existsSync(path)).toBe(false);
    const row = (await ctx.deps.db.query(`SELECT wallpaper, wallpaper_at FROM users WHERE id = $1`, [u.id])).rows[0];
    expect(row).toEqual({ wallpaper: null, wallpaper_at: null });
  });
});
