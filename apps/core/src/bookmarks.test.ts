import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import sharp from 'sharp';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookmarkKey, bookmarkletSource } from '@app/shared';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser, TEST_PASSWORD } from './test/harness';
import { importBookmarks, plainText, pngFromIco, readPage } from './bookmarks';
import { processNext } from './exports/service';
import { deleteAccount } from './deletion';

describe('reading a page for a bookmark', () => {
  it('takes the title, description and icons as plain text, and prefers what the page says about itself', () => {
    const html = `<html><head><title>Plain &amp; simple</title>
      <meta property="og:title" content="The &quot;real&quot; title">
      <meta name="description" content="A page about <b>things</b>&#33;">
      <link rel="apple-touch-icon" href="/touch.png"><link rel="icon" type="image/png" href="icon-32.png">
      <link rel="icon" href="/mark.svg"></head><body>…</body></html>`;
    const p = readPage(html, 'https://example.com/docs/page');
    expect(p.title).toBe('The "real" title');
    expect(p.description).toBe('A page about things !');
    expect(p.icons).toEqual(['https://example.com/docs/icon-32.png', 'https://example.com/touch.png', 'https://example.com/favicon.ico']);
  });
  it('falls back to the title tag, and keeps nothing that could run or hide', () => {
    const p = readPage(`<title>‮evil\u0007 <script>alert(1)</script> name</title><link rel=icon href="javascript:alert(1)">`, 'https://example.com/');
    expect(p.title).toBe('evil alert(1) name');
    expect(p.icons).toEqual(['https://example.com/favicon.ico']);
    expect(plainText('&#0; &#xD800; &bogus; ok', 50)).toBe('&bogus; ok');
    expect(plainText('x'.repeat(500), 10)).toHaveLength(10);
  });
  it('spots the same address without its fragment or tracking parameters', () => {
    expect(bookmarkKey('https://Example.com/a?utm_source=x&id=3&fbclid=9#top')).toBe('https://example.com/a?id=3');
    expect(bookmarkKey('https://example.com/')).toBe(bookmarkKey('https://EXAMPLE.com'));
    expect(bookmarkKey('https://example.com/a')).not.toBe(bookmarkKey('https://example.com/b'));
  });
  it('makes a bookmarklet that only opens the add form', () => {
    const js = bookmarkletSource('https://site.test');
    expect(js).toMatch(/^javascript:/);
    expect(js).toContain('"https://site.test/bookmarks/add"');
    expect(js).toContain('encodeURIComponent(location.href)');
  });
  it('finds a PNG inside an .ico file', async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const head = Buffer.alloc(22);
    head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
    head[6] = 32; head[7] = 32; head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
    expect(pngFromIco(Buffer.concat([head, png]))?.equals(png)).toBe(true);
    expect(pngFromIco(Buffer.from('not an icon'))).toBeNull();
  });
});

describe.skipIf(!dbAvailable)('bookmarks', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: http.Server;
  let base = '';
  let hits = 0;

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.allowPrivateFetch = true;
    const icon = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#2266aa' } }).png().toBuffer();
    // A small web server: a page with a title and icon, a big page whose title is at the top, and one that fails.
    server = http.createServer((req, res) => {
      hits += 1;
      if (req.url?.startsWith('/article')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><head><title>Gardening for beginners</title><meta name="description" content="Start with tomatoes."><link rel="icon" href="/i.png"></head></html>');
        return;
      }
      if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<title>Big page</title>${'x'.repeat(2_000_000)}`); return; }
      if (req.url === '/i.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(icon); return; }
      res.writeHead(500); res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { server.close(); await drop(); });

  it('saves a link with the page\'s title, description and icon, and gives back the same one for the same address', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const r = await c.post('/api/v1/bookmarks', { url: `${base}/article?utm_source=feed`, tags: ['garden', 'Garden'] });
    expect(r.status).toBe(201);
    expect(r.body.bookmark).toMatchObject({ title: 'Gardening for beginners', description: 'Start with tomatoes.', tags: ['garden'], visibility: 'private', has_icon: true, pinned: false });
    const icon = await ctx.app.inject({ method: 'GET', url: `/api/v1/bookmarks/${r.body.bookmark.id}/icon`, headers: { cookie: `sid=${c.sid}` } });
    expect(icon.headers['content-type']).toBe('image/webp');
    expect((await sharp(icon.rawPayload).metadata()).width).toBe(32);
    const before = hits;
    const again = await c.post('/api/v1/bookmarks', { url: `${base}/article#comments` });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ existing: true, bookmark: { id: r.body.bookmark.id } });
    expect(hits).toBe(before); // a duplicate doesn't fetch the page again
  });

  it('reads only the top of a big page, and still saves a link whose page fails', async () => {
    const c = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await c.post('/api/v1/bookmarks', { url: `${base}/big` })).body.bookmark.title).toBe('Big page');
    const broken = await c.post('/api/v1/bookmarks', { url: `${base}/broken/page` });
    expect(broken.status).toBe(201);
    expect(broken.body.bookmark).toMatchObject({ title: '127.0.0.1/broken/page', description: '', has_icon: false });
    // What the person typed wins, and nothing is fetched when they gave both.
    const before = hits;
    const typed = await c.post('/api/v1/bookmarks', { url: `${base}/article/2`, title: 'My own name', description: '' });
    expect(typed.body.bookmark).toMatchObject({ title: 'My own name' });
    expect(hits).toBe(before);
  });

  it('refuses other schemes, guests, and other people\'s bookmarks', async () => {
    const c = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await c.post('/api/v1/bookmarks', { url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await c.post('/api/v1/bookmarks', { url: 'https://me:pw@example.com/' })).status).toBe(400);
    expect((await c.post('/api/v1/bookmarks', { url: 'https://example.com/', title: 'x', description: '', visibility: 'public' })).status).toBe(400); // sharing comes later
    const guest = await loginAs(ctx, (await makeUser(ctx, { role: 'guest', verified: false })).handle);
    expect((await guest.post('/api/v1/bookmarks', { url: 'https://example.com/', title: 'x', description: '' })).status).toBe(403);
    const mine = (await c.post('/api/v1/bookmarks', { url: 'https://example.com/mine', title: 'Mine', description: '' })).body.bookmark;
    const other = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await other.get(`/api/v1/bookmarks/${mine.id}`)).status).toBe(404);
    expect((await other.patch(`/api/v1/bookmarks/${mine.id}`, { title: 'Theirs' })).status).toBe(404);
    expect((await other.delete(`/api/v1/bookmarks/${mine.id}`)).status).toBe(404);
    expect((await other.get('/api/v1/bookmarks')).body.total).toBe(0);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/bookmarks' })).statusCode).toBe(401);
  });

  it('edits, pins, tags, searches, pages and deletes', async () => {
    const c = await loginAs(ctx, (await makeUser(ctx)).handle);
    const add = async (n: number, extra: Record<string, unknown> = {}) => (await c.post('/api/v1/bookmarks', { url: `https://example.com/p/${n}`, title: `Page ${n}`, description: '', ...extra })).body.bookmark;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await add(i, { tags: i % 2 ? ['odd'] : ['even'] })).id);
    const recipe = await add(9, { title: 'Lentil soup', description: 'A winter recipe' });
    expect((await c.patch(`/api/v1/bookmarks/${recipe.id}`, { pinned: true, tags: ['food'] })).body).toMatchObject({ pinned: true, tags: ['food'] });
    expect((await c.patch(`/api/v1/bookmarks/${recipe.id}`, { url: 'https://example.com/p/1' })).status).toBe(409); // already saved
    expect((await c.get('/api/v1/bookmarks?q=winter')).body.bookmarks.map((b: { id: string }) => b.id)).toEqual([recipe.id]);
    expect((await c.get('/api/v1/bookmarks?q=food')).body.total).toBe(1); // tags are searched too
    expect((await c.get('/api/v1/bookmarks?tag=odd')).body.total).toBe(2);
    expect((await c.get('/api/v1/bookmarks?pinned=true')).body.total).toBe(1);
    expect((await c.get('/api/v1/bookmarks/tags')).body.tags).toEqual([{ tag: "even", count: 3 }, { tag: "odd", count: 2 }, { tag: "food", count: 1 }]);
    const hub = (await c.get('/api/v1/bookmarks/hub')).body;
    expect(hub.pinned.map((b: { id: string }) => b.id)).toEqual([recipe.id]);
    expect(hub.recent).toHaveLength(5);
    const p1 = (await c.get('/api/v1/bookmarks?limit=4')).body;
    expect(p1.bookmarks).toHaveLength(4);
    const p2 = (await c.get(`/api/v1/bookmarks?limit=4&before=${encodeURIComponent(p1.next)}`)).body;
    expect(p2.bookmarks).toHaveLength(2);
    expect(p2.next).toBeNull();
    expect(new Set([...p1.bookmarks, ...p2.bookmarks].map((b: { id: string }) => b.id)).size).toBe(6);
    expect((await c.delete(`/api/v1/bookmarks/${ids[0]}`)).status).toBe(204);
    expect((await c.get('/api/v1/bookmarks')).body.total).toBe(5);
  });

  it('is in the export, comes back private on import, and goes with the account', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await c.post('/api/v1/bookmarks', { url: 'https://example.com/kept', title: 'Kept', description: 'A note', tags: ['keep'], pinned: true });
    expect((await c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await ctx.deps.db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [u.id])).rows[0]!;
    const files = unzipSync(new Uint8Array(readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`))));
    const list = JSON.parse(strFromU8(files['bookmarks.json']!));
    expect(list).toEqual([expect.objectContaining({ url: 'https://example.com/kept', title: 'Kept', description: 'A note', tags: ['keep'], pinned: true, visibility: 'private', ring: null })]);

    const v = await makeUser(ctx);
    const session = (await ctx.deps.db.query(`SELECT * FROM users WHERE id = $1`, [v.id])).rows[0];
    const viewer = { userId: v.id, handle: session.handle, role: 'user' } as Parameters<typeof importBookmarks>[1];
    const r = await importBookmarks(ctx.deps, viewer, [...list, { ...list[0], url: 'https://example.com/shared', visibility: 'public' }, { url: 'ftp://nope' }]);
    expect(r).toEqual({ restored: 2, codes: ['made_private', 'invalid'] });
    const again = await importBookmarks(ctx.deps, viewer, list);
    expect(again).toEqual({ restored: 0, codes: ['exists'] });
    const rows = (await ctx.deps.db.query(`SELECT url, visibility, created_at FROM bookmarks WHERE user_id = $1 ORDER BY url`, [v.id])).rows;
    expect(rows.map((b) => b.visibility)).toEqual(['private', 'private']);
    expect(rows[0].created_at.toISOString()).toBe(list[0].created_at); // keeps when it was saved

    await deleteAccount(ctx.deps, u.id, { posts: 'keep', actor: null }, {});
    expect((await ctx.deps.db.query(`SELECT 1 FROM bookmarks WHERE user_id = $1`, [u.id])).rowCount).toBe(0);
  });
});
