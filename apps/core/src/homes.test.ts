import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, symlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHomesApp } from './homes/server';
import { cleanPath } from './homes/files';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser, SITE_YAML } from './test/harness';

describe('cleanPath', () => {
  it('accepts ordinary names and folders', () => {
    expect(cleanPath('index.html')).toBe('index.html');
    expect(cleanPath('/img/cat.gif/')).toBe('img/cat.gif');
    expect(cleanPath('a_b/c-d/e~1.txt')).toBe('a_b/c-d/e~1.txt');
    expect(cleanPath('', { allowRoot: true })).toBe('');
  });
  it('refuses anything that could leave the folder or hide', () => {
    for (const p of ['../x', 'a/../b', '.htaccess', 'a/.git/x', 'a b.html', 'C:\\x.html', 'a\\b', 'a/./b', 'x'.repeat(101), 'a/b/c/d/e/f/g/h/i', 'na\u0000me', '', '-dash.html', 'é.html']) {
      expect(() => cleanPath(p), JSON.stringify(p)).toThrow();
    }
  });
});

describe.skipIf(!dbAvailable)('homepages', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: Awaited<ReturnType<typeof buildHomesApp>>;
  type P = { id: string; handle: string; c: ReturnType<typeof client> };
  let alice: P, bob: P;

  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => {
    const u = await makeUser(ctx, { role, handle });
    return { id: u.id, handle, c: await loginAs(ctx, handle) };
  };
  const put = (p: P, path: string, body: string | Buffer, type = 'text/html') =>
    ctx.app.inject({ method: 'PUT', url: `/api/v1/homes/me/file?path=${encodeURIComponent(path)}`, payload: body, headers: { origin: 'https://example.test', cookie: `sid=${p.c.sid}`, 'content-type': type } });
  const get = (host: string, url: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET') => server.inject({ method, url, headers: { host, ...headers } });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    // A tiny quota so limits are easy to reach: 10 KB for users, 20 KB for trusted, 6 KB per file.
    ctx = await makeApp(db, { yaml: SITE_YAML('limits: { homepage_quota_mb: { user: 0.01, trusted: 0.02 }, homepage_file_max_mb: 0.006 }') });
    server = await buildHomesApp(ctx.deps);
    alice = await person('alice');
    bob = await person('bob');
  });
  afterAll(async () => { await server.close(); await drop(); });

  describe('the studio live preview', () => {
    let drafty: P;
    beforeAll(async () => { drafty = await person('drafty'); });
    const preview = (p: P, path: string, body: string) =>
      ctx.app.inject({ method: 'PUT', url: `/api/v1/homes/me/preview?path=${encodeURIComponent(path)}`, payload: body, headers: { origin: 'https://example.test', cookie: `sid=${p.c.sid}`, 'content-type': 'text/html' } });

    it('shows unsaved text at a token address, with the saved files around it, and nowhere else', async () => {
      await put(drafty, 'index.html', '<h1>Saved</h1>');
      await put(drafty, 'style.css', 'body{color:red}');
      const r = await preview(drafty, 'index.html', '<h1>Draft in progress</h1>');
      expect(r.statusCode).toBe(200);
      const { token } = r.json() as { token: string };
      const host = 'drafty.example-homes.test';
      const draft = await get(host, `/__preview/${token}/index.html`);
      expect(draft.statusCode).toBe(200);
      expect(draft.body).toContain('Draft in progress');
      expect(draft.headers['cache-control']).toBe('no-store');
      expect(draft.headers['content-security-policy']).toContain('frame-ancestors');
      expect((await get(host, `/__preview/${token}/`)).body).toContain('Draft in progress');            // the front page by its folder
      expect((await get(host, `/__preview/${token}/style.css`)).body).toBe('body{color:red}');          // other files come from what is saved
      expect((await get(host, '/')).body).toContain('Saved');                                          // the published page is untouched
      // A wrong token, or the right one on someone else's address, never shows the draft: it is just the published page.
      expect((await get(host, '/__preview/AAAAAAAAAAAAAAAAAAAAAAAA/index.html')).body).not.toContain('Draft');
      expect((await get('bob.example-homes.test', `/__preview/${token}/index.html`)).body).not.toContain('Draft');
      // The same token keeps working as the text changes; a different file gets a new one.
      expect(((await preview(drafty, 'index.html', '<h1>Draft two</h1>')).json() as { token: string }).token).toBe(token);
      expect((await get(host, `/__preview/${token}/index.html`)).body).toContain('Draft two');
      expect(((await preview(drafty, 'style.css', 'b{}')).json() as { token: string }).token).not.toBe(token);
    });

    it('ignores a draft after ten minutes, refuses files that are not text, and needs a person signed in', async () => {
      const { token } = (await preview(drafty, 'index.html', '<p>old</p>')).json() as { token: string };
      await db.query(`UPDATE home_previews SET updated_at = now() - interval '11 minutes' WHERE user_id = $1`, [drafty.id]);
      expect((await get('drafty.example-homes.test', `/__preview/${token}/index.html`)).body).not.toContain('old');
      expect((await preview(drafty, 'pic.png', 'x')).statusCode).toBe(415);
      expect((await ctx.app.inject({ method: 'PUT', url: '/api/v1/homes/me/preview?path=index.html', payload: 'x', headers: { origin: 'https://example.test', 'content-type': 'text/html' } })).statusCode).toBe(401);
    });
  });

  describe('the studio API', () => {
    it('starts empty, and a guest cannot have a homepage', async () => {
      const r = await alice.c.get('/api/v1/homes/me');
      expect(r.body.homepage).toMatchObject({ has_index: false, size_bytes: 0, file_count: 0, url: 'https://alice.example-homes.test/', hidden: false });
      expect(r.body.files).toEqual([]);
      const g = await makeUser(ctx, { role: 'guest', verified: false });
      expect((await (await loginAs(ctx, g.handle)).get('/api/v1/homes/me')).body.error.code).toBe('email_not_verified');
      expect((await client(ctx.app).get('/api/v1/homes/me')).status).toBe(401);
    });

    it('makes a page from a template, keeps an existing front page unless told to replace it', async () => {
      const t = (await alice.c.get('/api/v1/homes/templates')).body.templates as { id: string }[];
      expect(t.map((x) => x.id)).toEqual(['blank', 'about-me', 'fan-page']);
      expect((await alice.c.post('/api/v1/homes/me/template', { template: 'about-me' })).status).toBe(204);
      const mine = (await alice.c.get('/api/v1/homes/me')).body;
      expect(mine.homepage).toMatchObject({ has_index: true, title: "alice's page" });
      expect(mine.files.map((f: { path: string }) => f.path).sort()).toEqual(['index.html', 'links.html', 'style.css']);
      expect((await alice.c.post('/api/v1/homes/me/template', { template: 'blank' })).body.error.code).toBe('not_empty');
      expect((await alice.c.post('/api/v1/homes/me/template', { template: 'blank', replace: true })).status).toBe(204);
      expect((await alice.c.post('/api/v1/homes/me/template', { template: 'nope', replace: true })).status).toBe(404);
    });

    it('escapes what a person types into a template', async () => {
      await alice.c.patch('/api/v1/homes/me', { title: '<script>alert(1)</script>' });
      await alice.c.post('/api/v1/homes/me/template', { template: 'blank', replace: true });
      const html = (await alice.c.get('/api/v1/homes/me/file?path=index.html')).body.content as string;
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
      await alice.c.patch('/api/v1/homes/me', { title: "Alice's corner" });
    });

    it('saves, reads and lists files, and tracks size and the front page', async () => {
      expect((await put(alice, 'index.html', '<h1>hello</h1>')).statusCode).toBe(204);
      expect((await put(alice, 'img/pixel.gif', Buffer.from('GIF89a'), 'image/gif')).statusCode).toBe(204);
      const read = (await alice.c.get('/api/v1/homes/me/file?path=index.html')).body;
      expect(read).toEqual({ path: 'index.html', content: '<h1>hello</h1>' });
      const mine = (await alice.c.get('/api/v1/homes/me')).body;
      expect(mine.files.find((f: { path: string }) => f.path === 'img')).toMatchObject({ type: 'dir' });
      expect(mine.files.find((f: { path: string }) => f.path === 'img/pixel.gif')).toMatchObject({ type: 'file', size: 6, editable: false });
      expect(mine.homepage.size_bytes).toBeGreaterThan(0);
      expect((await alice.c.get('/api/v1/homes/me/file?path=img/pixel.gif')).status).toBe(415);
      expect((await alice.c.get('/api/v1/homes/me/file?path=missing.html')).status).toBe(404);
    });

    it('refuses file types that are not on the list, paths that escape, and folders where files go', async () => {
      expect((await put(alice, 'run.php', '<?php ?>', 'text/plain')).statusCode).toBe(415);
      expect((await put(alice, 'noext', 'x', 'text/plain')).statusCode).toBe(415);
      expect((await put(alice, '../../etc/passwd.txt', 'x', 'text/plain')).statusCode).toBe(400);
      expect((await put(alice, '.htaccess', 'x', 'text/plain')).statusCode).toBe(400);
      expect((await put(alice, 'img', 'x', 'text/plain')).statusCode).toBe(415);
      expect((await put(alice, 'img.txt/inner.txt', 'x', 'text/plain')).statusCode).toBe(204);
      expect((await put(alice, 'index.html/x.txt', 'x', 'text/plain')).statusCode).toBe(409); // a file is in the way
      await alice.c.post('/api/v1/homes/me/folders', { path: 'stuff.html' });
      expect((await put(alice, 'stuff.html', '<p>x</p>')).statusCode).toBe(409);
    });

    it('keeps to the size of a file and the quota, even for uploads made at the same moment', async () => {
      const big = await put(alice, 'big.txt', 'x'.repeat(7000), 'text/plain');
      expect(big.statusCode).toBe(413);
      expect(big.json().error.code).toBe('file_too_large');
      const cleanup = await person('carol');
      // 10 KB quota: five 3 KB files at once can only fit three.
      const results = await Promise.all([1, 2, 3, 4, 5].map((i) => put(cleanup, `f${i}.txt`, 'y'.repeat(3000), 'text/plain')));
      expect(results.filter((r) => r.statusCode === 204)).toHaveLength(3);
      expect(results.find((r) => r.statusCode !== 204)!.json().error.code).toBe('quota_exceeded');
      const mine = (await cleanup.c.get('/api/v1/homes/me')).body;
      expect(mine.homepage.size_bytes).toBeLessThanOrEqual(mine.homepage.quota_bytes);
      // Replacing a file counts only the difference.
      expect((await put(cleanup, 'f1.txt', 'z'.repeat(4000), 'text/plain')).statusCode).toBe(204);
      // Trusted users get more space.
      const t = await person('trusty', 'trusted');
      expect((await t.c.get('/api/v1/homes/me')).body.homepage.quota_bytes).toBe(Math.floor(0.02 * 1048576));
    });

    it('makes folders, moves and deletes, and refuses silly moves', async () => {
      const d = await person('dora');
      expect((await put(d, 'a.txt', 'a', 'text/plain')).statusCode).toBe(204);
      expect((await d.c.post('/api/v1/homes/me/folders', { path: 'pics/old' })).status).toBe(201);
      expect((await d.c.post('/api/v1/homes/me/folders', { path: 'pics' })).body.error.code).toBe('exists');
      expect((await d.c.post('/api/v1/homes/me/move', { from: 'a.txt', to: 'pics/a.txt' })).status).toBe(204);
      expect((await d.c.post('/api/v1/homes/me/move', { from: 'pics/a.txt', to: 'pics/a.php' })).status).toBe(415);
      expect((await d.c.post('/api/v1/homes/me/move', { from: 'pics', to: 'pics/old/inside' })).status).toBe(400);
      expect((await d.c.post('/api/v1/homes/me/move', { from: 'nothing', to: 'x' })).status).toBe(404);
      await put(d, 'b.txt', 'b', 'text/plain');
      expect((await d.c.post('/api/v1/homes/me/move', { from: 'b.txt', to: 'pics/a.txt' })).body.error.code).toBe('exists');
      expect((await d.c.delete('/api/v1/homes/me/file?path=pics')).status).toBe(204);
      expect((await d.c.get('/api/v1/homes/me')).body.files.map((f: { path: string }) => f.path)).toEqual(['b.txt']);
      expect((await d.c.delete('/api/v1/homes/me/file?path=pics')).status).toBe(404);
    });

    it('lists the asset library, serves a picture safely, and copies one into your own files', async () => {
      const list = (await alice.c.get('/api/v1/homes/assets')).body.assets as { id: string }[];
      expect(list.map((a) => a.id)).toContain('divider-rainbow');
      const pic = await ctx.app.inject({ method: 'GET', url: '/api/v1/homes/assets/divider-rainbow' });
      expect(pic.headers['content-type']).toBe('image/svg+xml');
      expect(pic.headers['content-security-policy']).toContain("default-src 'none'");
      expect(pic.headers['x-content-type-options']).toBe('nosniff');
      expect((await alice.c.get('/api/v1/homes/assets/nope')).status).toBe(404);
      expect((await alice.c.post('/api/v1/homes/me/assets', { id: 'divider-rainbow' })).body).toEqual({ path: 'assets/divider-rainbow.svg' });
      expect((await alice.c.post('/api/v1/homes/me/assets', { id: 'divider-rainbow' })).status).toBe(200); // again is fine
      expect((await alice.c.get('/api/v1/homes/me')).body.files.map((f: { path: string }) => f.path)).toContain('assets/divider-rainbow.svg');
      expect((await alice.c.post('/api/v1/homes/me/assets', { id: 'nope' })).status).toBe(404);
      await alice.c.delete('/api/v1/homes/me/file?path=assets');
    });

    it('needs the site’s own origin for changes, and gives each person their own space', async () => {
      const r = await ctx.app.inject({ method: 'PUT', url: '/api/v1/homes/me/file?path=evil.txt', payload: 'x', headers: { origin: 'https://evil.example', cookie: `sid=${alice.c.sid}`, 'content-type': 'text/plain' } });
      expect(r.statusCode).toBe(403);
      await put(bob, 'index.html', '<p>bob</p>');
      expect((await alice.c.get('/api/v1/homes/me/file?path=index.html')).body.content).not.toContain('bob');
      expect(readdirSync(ctx.deps.homes.root).sort()).toContain(bob.id);
    });
  });

  describe('the homes server', () => {
    const H = 'example-homes.test';
    beforeAll(async () => {
      await put(alice, 'index.html', '<html><body><h1>Alice</h1></body></html>');
      await put(alice, 'style.css', 'body{color:red}', 'text/css');
      await put(alice, 'docs/index.html', '<p>docs</p>');
      await put(alice, 'song.mp3', Buffer.alloc(2000, 1), 'audio/mpeg');
      await put(alice, 'notes.txt', 'plain', 'text/plain');
      await put(bob, 'secret.txt', 'bob only', 'text/plain');
    });

    it('serves the front page on the person’s own subdomain, with the report link added', async () => {
      const r = await get(`alice.${H}`, '/');
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.body).toContain('<h1>Alice</h1>');
      expect(r.body).toMatch(/Report this page<\/a><\/div><\/body>/);
      expect(r.body).toContain('https://example.test/report/homepage/alice');
      expect((await get(`ALICE.${H}:4444`, '/')).statusCode).toBe(200); // case and port do not matter
    });

    it('adds the report link even to a page with no closing body tag', async () => {
      await put(alice, 'loose.html', '<p>no end tag');
      expect((await get(`alice.${H}`, '/loose.html')).body).toContain('site-report-footer');
    });

    it('serves other files with the right type, safe headers, no cookies, and only the site may frame it', async () => {
      const css = await get(`alice.${H}`, '/style.css');
      expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
      for (const r of [css, await get(`alice.${H}`, '/')]) {
        expect(r.headers['x-content-type-options']).toBe('nosniff');
        expect(r.headers['content-security-policy']).toBe("frame-ancestors 'self' https://example.test");
        expect(r.headers['set-cookie']).toBeUndefined();
      }
      expect((await get(`alice.${H}`, '/notes.txt')).headers['content-type']).toBe('text/plain; charset=utf-8');
      expect((await get(`alice.${H}`, '/docs/')).body).toContain('<p>docs</p>');
      const head = await get(`alice.${H}`, '/style.css', {}, 'HEAD');
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
    });

    it('lets audio and video seek with range requests, and supports conditional requests', async () => {
      const r = await get(`alice.${H}`, '/song.mp3', { range: 'bytes=0-99' });
      expect(r.statusCode).toBe(206);
      expect(r.headers['content-range']).toBe('bytes 0-99/2000');
      const full = await get(`alice.${H}`, '/song.mp3');
      const again = await get(`alice.${H}`, '/song.mp3', { 'if-none-match': String(full.headers.etag) });
      expect(again.statusCode).toBe(304);
    });

    it('redirects a folder to its trailing slash', async () => {
      const r = await get(`alice.${H}`, '/docs');
      expect(r.statusCode).toBe(301);
      expect(r.headers.location).toBe('/docs/');
    });

    it('does not serve dotfiles, ways out of the folder, or another person’s files', async () => {
      for (const url of ['/%2e%2e/bob/secret.txt', '/../secret.txt', '/.hidden', '/docs/.x', '/%2e%2e%2f%2e%2e%2f', '/a%5cb', '/x%00']) {
        const r = await get(`alice.${H}`, url);
        expect([400, 404], url).toContain(r.statusCode);
        expect(r.body).not.toContain('bob only');
      }
      expect((await get(`alice.${H}`, '/secret.txt')).statusCode).toBe(404);
      expect((await get(`bob.${H}`, '/secret.txt')).body).toBe('bob only');
    });

    it('ignores symbolic links that were not made by the site', async () => {
      const dir = ctx.deps.homes.dir(alice.id);
      writeFileSync(join(ctx.deps.homes.root, 'outside.txt'), 'outside the folder');
      symlinkSync(join(ctx.deps.homes.root, 'outside.txt'), join(dir, 'link.txt'));
      mkdirSync(join(dir, 'real'), { recursive: true });
      expect((await get(`alice.${H}`, '/link.txt')).statusCode).toBe(404);
      expect(((await alice.c.get('/api/v1/homes/me')).body.files as { path: string }[]).map((f) => f.path)).not.toContain('link.txt');
    });

    it('says plainly when there is nothing there, and uses the person’s own 404.html if they made one', async () => {
      expect((await get(`nobody.${H}`, '/')).statusCode).toBe(404);
      expect((await get(`nobody.${H}`, '/')).body).toContain('There is no homepage here.');
      expect((await get(`alice.${H}`, '/missing.html')).statusCode).toBe(404);
      expect((await get(`alice.${H}`, '/missing.html')).body).toContain('There is no homepage here.');
      await put(alice, '404.html', '<h1>Lost in space</h1>');
      const r = await get(`alice.${H}`, '/missing.html');
      expect(r.statusCode).toBe(404);
      expect(r.body).toContain('Lost in space');
      expect((await get(`a.b.alice.${H}`, '/')).statusCode).toBe(404);
      expect((await get('elsewhere.test', '/')).statusCode).toBe(404);
    });

    it('does not serve a hidden, suspended or deleted person’s page', async () => {
      const e = await person('ed');
      await put(e, 'index.html', '<p>ed</p>');
      expect((await get(`ed.${H}`, '/')).statusCode).toBe(200);
      await db.query(`UPDATE homepages SET hidden_at = now() WHERE user_id = $1`, [e.id]);
      expect((await get(`ed.${H}`, '/')).statusCode).toBe(410);
      await db.query(`UPDATE homepages SET hidden_at = NULL WHERE user_id = $1`, [e.id]);
      await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [e.id]);
      expect((await get(`ed.${H}`, '/')).statusCode).toBe(404);
    });

    it('sends the stable address to whoever has that ID now', async () => {
      const r = await get(H, `/u/${alice.id}/docs/?x=1`);
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe('https://alice.example-homes.test/docs/?x=1');
      expect((await get(H, '/u/u_00000000000000000000000000/')).statusCode).toBe(404);
      expect((await get(H, '/')).statusCode).toBe(404);
    });

    it('keeps an old address working for 90 days after a rename, and no longer', async () => {
      await db.query(`INSERT INTO handle_history (user_id, handle, changed_at) VALUES ($1, 'oldalice', now() - interval '89 days'), ($1, 'ancient', now() - interval '91 days')`, [alice.id]);
      const r = await get(`oldalice.${H}`, '/docs/?a=b');
      expect(r.statusCode).toBe(301);
      expect(r.headers.location).toBe('https://alice.example-homes.test/docs/?a=b');
      expect((await get(`ancient.${H}`, '/')).statusCode).toBe(404);
    });
  });
});
