import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

// Atom feeds (docs/05): public boards only, nothing hidden or deleted, escaped text, stable ids, and 304s.
describe.skipIf(!dbAvailable)('Atom feeds', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let thread = '';
  let hidden = '';

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.config.limits.trusted_board_quota = 5;
    const admin = await makeAdmin(ctx);
    const owner = await makeUser(ctx, { role: 'trusted', handle: 'feeder' });
    const c = await loginAs(ctx, owner.handle);
    await c.post('/api/v1/boards', { slug: 'lobby', name: 'Lobby & friends', visibility: 'public' });
    await c.post('/api/v1/boards', { slug: 'secret', name: 'Secret', visibility: 'private' });
    await c.post('/api/v1/boards', { slug: 'inner', name: 'Inner', visibility: 'members' });
    thread = (await c.post('/api/v1/boards/lobby/posts', { subject: 'Hello <feeds>', body: 'A <script>alert(1)</script> & more' })).body.id;
    await c.post('/api/v1/boards/lobby/posts', { body: 'A reply', reply_to: thread });
    hidden = (await c.post('/api/v1/boards/lobby/posts', { subject: 'Spam', body: 'buy now' })).body.id;
    expect((await admin.client.post('/api/v1/mod-actions', { action: 'hide', post_id: hidden, reason: 'spam' })).status).toBe(201);
    await c.post('/api/v1/boards/secret/posts', { subject: 'Hidden plans', body: 'nope' });
    await c.post('/api/v1/boards/inner/posts', { subject: 'Members only', body: 'nope' });
  });
  afterAll(async () => drop());

  const get = (url: string, headers?: Record<string, string>) => client(ctx.app).get(url, headers);

  it('a public board\'s new threads, as well-formed Atom with escaped text and stable ids', async () => {
    const r = await get('/feeds/boards/lobby.atom');
    expect(r.status).toBe(200);
    expect(r.res.headers['content-type']).toContain('application/atom+xml');
    const xml = r.res.body;
    expect(xml).toContain('<title>Lobby &amp; friends - Test Site</title>');
    expect(xml).toContain('<title>Hello &lt;feeds&gt;</title>');
    expect(xml).toContain('A &lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain(`<id>tag:example.test,2026:post/${thread}</id>`);
    expect(xml).toContain(`href="https://example.test/boards/lobby/t/${thread}"`);
    expect(xml).not.toContain('A reply'); // threads only
    expect(xml).not.toContain('Spam'); // hidden by a moderator
    expect(xml.match(/<entry>/g)).toHaveLength(1);
  });

  it('a thread, a person and everything public, and never a private or members-only board', async () => {
    expect((await get(`/feeds/boards/lobby/threads/${thread}.atom`)).res.body.match(/<entry>/g)).toHaveLength(2);
    const person = (await get('/feeds/people/feeder.atom')).res.body;
    expect(person).toContain('A reply');
    for (const body of [person, (await get('/feeds/all.atom')).res.body]) {
      expect(body).not.toContain('Hidden plans');
      expect(body).not.toContain('Members only');
    }
    for (const url of ['/feeds/boards/secret.atom', '/feeds/boards/inner.atom', '/feeds/boards/lobby', '/feeds/people/nobody.atom', `/feeds/boards/lobby/threads/${hidden}.atom`]) {
      expect((await get(url)).status, url).toBe(404);
    }
  });

  it('answers 304 to a reader that already has the latest', async () => {
    const first = await get('/feeds/boards/lobby.atom');
    const etag = String(first.res.headers.etag);
    expect(first.res.headers['cache-control']).toBe('public, max-age=300');
    expect((await get('/feeds/boards/lobby.atom', { 'if-none-match': etag })).status).toBe(304);
  });
});
