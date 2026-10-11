import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import sharp from 'sharp';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bookmarkKey, bookmarkletSource, sharedAddress } from '@app/shared';
import { parseNetscape } from './bookmarks-import';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';
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

describe('importing a browser bookmarks file', () => {
  const file = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 ADD_DATE="1700000000">Cooking</H3>
  <DL><p>
    <DT><A HREF="https://example.com/soup?utm_source=x" ADD_DATE="1700000100" TAGS="food,Soup Recipes">Lentil &amp; <b>spice</b> soup</A>
    <DD>A winter <i>staple</i>.
    <DT><A HREF='https://example.com/bread' ADD_DATE=1700000200>Bread</A>
    <DT><A HREF="javascript:alert(1)">Not a link</A>
    <DT><A HREF="https://me:pw@example.com/">Has a password</A>
  </DL><p>
  <DT><A HREF="http://example.org/top">Outside the folder</A>
</DL><p>`;
  it('reads links with their titles, descriptions, tags, folder and date, and drops unsafe addresses', () => {
    const list = parseNetscape(file);
    expect(list.map((b) => b.url)).toEqual(['https://example.com/soup?utm_source=x', 'https://example.com/bread', 'http://example.org/top']);
    expect(list[0]).toMatchObject({ title: 'Lentil & spice soup', description: 'A winter staple.', tags: ['food', 'soup-recipes', 'cooking'] });
    expect(list[0]!.created_at?.toISOString()).toBe('2023-11-14T22:15:00.000Z');
    expect(list[1]).toMatchObject({ title: 'Bread', description: '', tags: ['cooking'] });
    expect(list[2]!.tags).toEqual([]); // the folder is closed by then
  });
  it('gives up what it can from broken or hostile files', () => {
    expect(parseNetscape('')).toEqual([]);
    expect(parseNetscape('<A HREF="https://a.example/x">one<A HREF="https://a.example/y">two')).toHaveLength(2);
    expect(parseNetscape(`<A HREF="https://a.example/z"><script>alert(1)</script>Safe`)[0]!.title).toBe('alert(1) Safe');
  });
  it('finds the address in what a phone\'s Share menu sends', () => {
    expect(sharedAddress({ url: 'https://a.example/p', title: 'T' })).toEqual({ url: 'https://a.example/p', title: 'T' });
    expect(sharedAddress({ text: 'Great read https://a.example/p?x=1 thanks' })).toEqual({ url: 'https://a.example/p?x=1', title: 'Great read thanks' });
    expect(sharedAddress({ text: 'no address here' })).toEqual({ url: '', title: 'no address here' });
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
    expect((await c.post('/api/v1/bookmarks', { url: 'https://example.com/', title: 'x', description: '', visibility: 'ring' })).status).toBe(400); // which ring?
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

  it('checks a link on request: answering, not answering, and an edited address starts over', async () => {
    const c = await loginAs(ctx, (await makeUser(ctx)).handle);
    const good = (await c.post('/api/v1/bookmarks', { url: `${base}/article/check`, title: 'Good', description: '' })).body.bookmark;
    const bad = (await c.post('/api/v1/bookmarks', { url: `${base}/gone`, title: 'Gone', description: '' })).body.bookmark;
    const dead = (await c.post('/api/v1/bookmarks', { url: 'https://nowhere.invalid/x', title: 'Dead', description: '' })).body.bookmark;
    expect(good).toMatchObject({ link_ok: null, checked_at: null });
    expect((await c.post(`/api/v1/bookmarks/${good.id}/check`)).body).toMatchObject({ link_ok: true });
    expect((await c.post(`/api/v1/bookmarks/${bad.id}/check`)).body).toMatchObject({ link_ok: false });
    const checked = (await c.post(`/api/v1/bookmarks/${dead.id}/check`)).body;
    expect(checked.link_ok).toBe(false);
    expect(Date.parse(checked.checked_at)).toBeGreaterThan(Date.now() - 60_000);
    expect((await c.get('/api/v1/bookmarks?broken=true')).body.bookmarks.map((b: { id: string }) => b.id).sort()).toEqual([bad.id, dead.id].sort());
    expect((await c.patch(`/api/v1/bookmarks/${bad.id}`, { url: `${base}/article/fixed` })).body).toMatchObject({ link_ok: null, checked_at: null });
    const other = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await other.post(`/api/v1/bookmarks/${good.id}/check`)).status).toBe(404);
  });

  it('refuses to check an address that leads inside the server', async () => {
    ctx.deps.allowPrivateFetch = false;
    try {
      const c = await loginAs(ctx, (await makeUser(ctx)).handle);
      const b = (await c.post('/api/v1/bookmarks', { url: `${base}/article/private`, title: 'Inside', description: '' })).body.bookmark;
      expect((await c.post(`/api/v1/bookmarks/${b.id}/check`)).body.link_ok).toBe(false);
    } finally { ctx.deps.allowPrivateFetch = true; }
  });

  it('imports a browser bookmarks file as private bookmarks, skipping ones already saved', async () => {
    const c = await loginAs(ctx, (await makeUser(ctx)).handle);
    await c.post('/api/v1/bookmarks', { url: 'https://example.com/have', title: 'Have', description: '' });
    const html = `<DL><DT><H3>Reading</H3><DL>
      <DT><A HREF="https://example.com/have#x" ADD_DATE="1700000000">Have it</A>
      <DT><A HREF="https://example.com/new1" ADD_DATE="1700000100" TAGS="a-tag">New one</A><DD>Why it matters
      <DT><A HREF="https://example.com/new2">New two</A></DL></DL>`;
    const post = (body: string | Buffer) => ctx.app.inject({ method: 'POST', url: '/api/v1/bookmarks/import', payload: body, headers: { origin: 'https://example.test', cookie: `sid=${c.sid}`, 'content-type': 'text/html' } });
    const r = await post(html);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ added: 2, existing: 1, invalid: 0, too_many: 0 });
    const list = (await c.get('/api/v1/bookmarks')).body.bookmarks;
    const one = list.find((b: { title: string }) => b.title === 'New one');
    expect(one).toMatchObject({ description: 'Why it matters', tags: ['a-tag', 'reading'], visibility: 'private' });
    expect(one.created_at).toBe('2023-11-14T22:15:00.000Z');
    expect((await post('nothing here')).statusCode).toBe(400);
    expect((await post(Buffer.alloc(0))).statusCode).toBe(400);
    expect((await post(Buffer.alloc(5 * 1024 * 1024 + 2, 'a'))).statusCode).toBe(413);
  });

  it('has the Share menu target in the app manifest', async () => {
    const m = (await ctx.app.inject({ method: 'GET', url: '/api/v1/site/manifest.webmanifest' })).json();
    expect(m.share_target).toEqual({ action: '/bookmarks/add', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } });
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
    const session = (await ctx.deps.db.query(`SELECT * FROM users WHERE id = $1`, [v.id])).rows[0]!;
    const viewer = { userId: v.id, handle: session.handle, role: 'user' } as Parameters<typeof importBookmarks>[1];
    const r = await importBookmarks(ctx.deps, viewer, [...list, { ...list[0], url: 'https://example.com/shared', visibility: 'public' }, { url: 'ftp://nope' }]);
    expect(r).toEqual({ restored: 2, codes: ['made_private', 'invalid'] });
    const again = await importBookmarks(ctx.deps, viewer, list);
    expect(again).toEqual({ restored: 0, codes: ['exists'] });
    const rows = (await ctx.deps.db.query(`SELECT url, visibility, created_at FROM bookmarks WHERE user_id = $1 ORDER BY url`, [v.id])).rows;
    expect(rows.map((b) => b.visibility)).toEqual(['private', 'private']);
    expect(rows[0]!.created_at.toISOString()).toBe(list[0].created_at); // keeps when it was saved

    await deleteAccount(ctx.deps, u.id, { posts: 'keep', actor: null }, {});
    expect((await ctx.deps.db.query(`SELECT 1 FROM bookmarks WHERE user_id = $1`, [u.id])).rowCount).toBe(0);
  });
});

describe.skipIf(!dbAvailable)('sharing bookmarks', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type P = { id: string; handle: string; c: Awaited<ReturnType<typeof loginAs>> };
  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => {
    const u = await makeUser(ctx, { role, handle });
    return { id: u.id, handle, c: await loginAs(ctx, handle) };
  };
  const add = (p: P, n: string, extra: Record<string, unknown> = {}) =>
    p.c.post('/api/v1/bookmarks', { url: `https://example.com/${n}`, title: `Link ${n}`, description: `About ${n}`, ...extra });
  const visitor = () => client(ctx.app);
  const ids = (r: { body: { bookmarks: { id: string }[] } }) => r.body.bookmarks.map((b) => b.id);

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
  });
  afterAll(async () => drop());

  it('shows public ones on the profile and in the feed, signed out, and never private ones', async () => {
    const ada = await person('ada_share');
    const pub = (await add(ada, 'pub', { visibility: 'public', tags: ['tools'] })).body.bookmark;
    const priv = (await add(ada, 'priv')).body.bookmark;
    const r = await visitor().get('/api/v1/bookmarks/public/ada_share');
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual([pub.id]);
    expect(r.body.bookmarks[0]).toMatchObject({ title: 'Link pub', visibility: 'public', owner: { handle: 'ada_share' }, can_hide: false });
    expect(r.body.bookmarks[0]).not.toHaveProperty('pinned');
    const feed = await ctx.app.inject({ method: 'GET', url: '/feeds/people/ada_share/bookmarks.atom' });
    expect(feed.statusCode).toBe(200);
    expect(feed.body).toContain('<title>Link pub</title>');
    expect(feed.body).toContain('href="https://example.com/pub"');
    expect(feed.body).not.toContain('Link priv');
    // Making it private takes it off again; the private one never shows.
    await ada.c.patch(`/api/v1/bookmarks/${pub.id}`, { visibility: 'private' });
    expect(ids(await visitor().get('/api/v1/bookmarks/public/ada_share'))).toEqual([]);
    expect((await visitor().get(`/api/v1/bookmarks/${priv.id}/icon`)).status).toBe(404);
  });

  it('shares into a ring only for its members, and leaving, removal or a ban makes them private again', async () => {
    const founder = await person('ring_founder', 'trusted');
    const bea = await person('bea_share');
    const cy = await person('cy_share');
    expect((await founder.c.post('/api/v1/rings', { slug: 'readers', name: 'Readers' })).status).toBe(201);
    expect((await add(bea, 'early', { visibility: 'ring', ring: 'readers' })).body.error.code).toBe('not_in_ring');
    await bea.c.post('/api/v1/rings/readers/join');
    await cy.c.post('/api/v1/rings/readers/join');
    const b1 = (await add(bea, 'r1', { visibility: 'ring', ring: 'readers' })).body.bookmark;
    const c1 = (await add(cy, 'c1', { visibility: 'ring', ring: 'readers' })).body.bookmark;
    expect(b1).toMatchObject({ visibility: 'ring', ring: { slug: 'readers', name: 'Readers' } });
    const page = await visitor().get('/api/v1/rings/readers/bookmarks');
    expect(ids(page).sort()).toEqual([b1.id, c1.id].sort());
    expect(ids(await visitor().get('/api/v1/bookmarks/public/bea_share'))).toEqual([]); // a ring link isn't on the profile

    await bea.c.post('/api/v1/rings/readers/leave');
    expect((await bea.c.get(`/api/v1/bookmarks/${b1.id}`)).body).toMatchObject({ visibility: 'private', ring: null });
    const founderAgain = await loginAs(ctx, 'ring_founder'); // ops are read at sign-in
    expect((await founderAgain.post(`/api/v1/rings/readers/members/${cy.id}/ban`, { reason: 'spam links' })).status).toBe(204);
    expect((await cy.c.get(`/api/v1/bookmarks/${c1.id}`)).body.visibility).toBe('private');
    expect(ids(await visitor().get('/api/v1/rings/readers/bookmarks'))).toEqual([]);
  });

  it('takes a suspended person\'s shared bookmarks away with them', async () => {
    const dee = await person('dee_share');
    await add(dee, 'gone', { visibility: 'public' });
    await ctx.deps.db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [dee.id]);
    expect((await visitor().get('/api/v1/bookmarks/public/dee_share')).status).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/feeds/people/dee_share/bookmarks.atom' })).statusCode).toBe(404);
  });

  it('reports a ring link to the ring\'s ops, who hide it with a reason (audited); the owner still sees it, marked', async () => {
    const founder = await person('op_founder', 'trusted');
    const eve = await person('eve_share');
    const fay = await person('fay_share');
    await founder.c.post('/api/v1/rings', { slug: 'makers', name: 'Makers' });
    await eve.c.post('/api/v1/rings/makers/join');
    const bm = (await add(eve, 'bad', { visibility: 'ring', ring: 'makers' })).body.bookmark;
    expect((await eve.c.post(`/api/v1/bookmarks/${bm.id}/report`, { category: 'spam' })).body.error.code).toBe('own_bookmark');
    expect((await fay.c.post(`/api/v1/bookmarks/${bm.id}/report`, { category: 'spam', note: 'ads' })).status).toBe(201);
    expect((await fay.c.post(`/api/v1/bookmarks/${bm.id}/report`, { category: 'spam' })).body.error.code).toBe('already_reported');
    const op = await loginAs(ctx, 'op_founder');
    const queue = (await op.get('/api/v1/reports')).body.reports;
    expect(queue).toEqual([expect.objectContaining({ target: expect.objectContaining({ type: 'bookmark', id: bm.id, handle: 'eve_share' }), bookmark: { title: 'Link bad', url: 'https://example.com/bad', hidden: false } })]);
    expect((await fay.c.get('/api/v1/reports')).status).toBe(403);
    expect((await fay.c.post(`/api/v1/bookmarks/${bm.id}/hide`, { reason: 'not mine to hide' })).status).toBe(403);
    expect(((await op.get('/api/v1/rings/makers/bookmarks')).body.bookmarks[0]).can_hide).toBe(true);
    expect((await op.post(`/api/v1/bookmarks/${bm.id}/hide`, { reason: 'advertising' })).status).toBe(204);
    expect(ids(await visitor().get('/api/v1/rings/makers/bookmarks'))).toEqual([]);
    expect((await eve.c.get(`/api/v1/bookmarks/${bm.id}`)).body.hidden).toEqual({ reason: 'advertising' });
    // Sharing it again doesn't bring it back.
    await eve.c.patch(`/api/v1/bookmarks/${bm.id}`, { visibility: 'public' });
    expect(ids(await visitor().get('/api/v1/bookmarks/public/eve_share'))).toEqual([]);
    const log = await ctx.deps.db.query(`SELECT action, after FROM audit_log WHERE target_id = $1 AND action LIKE 'bookmark.%'`, [bm.id]);
    expect(log.rows).toEqual([expect.objectContaining({ action: 'bookmark.hidden', after: expect.objectContaining({ reason: 'advertising' }) })]);
    // A public one is the admins' to hide; they put it back too.
    const admin = (await makeAdmin(ctx)).client;
    expect((await op.post(`/api/v1/bookmarks/${bm.id}/restore`, { reason: 'my mistake' })).status).toBe(403); // public now: not the ring's
    expect((await admin.post(`/api/v1/bookmarks/${bm.id}/restore`, { reason: 'fixed' })).status).toBe(204);
    expect(ids(await visitor().get('/api/v1/bookmarks/public/eve_share'))).toEqual([bm.id]);
  });

  it('serves a shared bookmark\'s icon to anyone, and a private one\'s only to its owner', async () => {
    const gus = await person('gus_share');
    const pub = (await add(gus, 'icon-pub', { visibility: 'public' })).body.bookmark;
    const icon = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#00ff00' } }).webp().toBuffer();
    await ctx.deps.db.query(`UPDATE bookmarks SET favicon = $2 WHERE id = $1`, [pub.id, icon]);
    const r = await ctx.app.inject({ method: 'GET', url: `/api/v1/bookmarks/${pub.id}/icon` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toMatch(/^public/);
    await gus.c.patch(`/api/v1/bookmarks/${pub.id}`, { visibility: 'private' });
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/bookmarks/${pub.id}/icon` })).statusCode).toBe(404);
    const own = await ctx.app.inject({ method: 'GET', url: `/api/v1/bookmarks/${pub.id}/icon`, headers: { cookie: `sid=${gus.c.sid}` } });
    expect(own.headers['cache-control']).toMatch(/^private/);
  });
});
