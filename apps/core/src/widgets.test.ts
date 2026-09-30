import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { widgetScript, WIDGET_NAMES } from './homes/widget-scripts';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

// The name is built from pieces so this file does not itself contain the placeholder (tests/placeholder-name.test.ts).
const SITE_NAMES = new RegExp(['test site', ['non', 'ternet'].join('')].join('|'), 'i');

describe('widget scripts', () => {
  it('are valid JavaScript, build their output without innerHTML, and never name the site', () => {
    expect(WIDGET_NAMES.sort()).toEqual(['counter', 'guestbook', 'online', 'updated']);
    for (const n of WIDGET_NAMES) {
      const src = widgetScript(n)!;
      expect(() => new Function(src), n).not.toThrow();
      expect(src, n).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
      expect(src, n).not.toMatch(SITE_NAMES);
    }
  });
});

describe.skipIf(!dbAvailable)('guestbooks, counters and the directory', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type P = { id: string; handle: string; c: ReturnType<typeof client> };
  let alice: P, bob: P;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const visitor = () => client(ctx.app);
  const ORIGIN = 'https://alice.example-homes.test';

  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => {
    const u = await makeUser(ctx, { role, handle });
    return { id: u.id, handle, c: await loginAs(ctx, handle) };
  };
  const site = (p: P, path: string, body: string) =>
    ctx.app.inject({ method: 'PUT', url: `/api/v1/homes/me/file?path=${path}`, payload: body, headers: { origin: 'https://example.test', cookie: `sid=${p.c.sid}`, 'content-type': 'text/plain' } });
  const wid = (method: 'GET' | 'POST' | 'OPTIONS', url: string, body?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({ method, url, payload: body as object | undefined, headers: { origin: ORIGIN, ...headers } });
  const sign = (handle: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => wid('POST', `/api/v1/widgets/${handle}/guestbook`, body, headers);

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    alice = await person('alice');
    bob = await person('bob');
    admin = await makeAdmin(ctx);
    await site(alice, 'index.html', '<h1>alice</h1>');
    await site(bob, 'index.html', '<h1>bob</h1>');
  });
  afterAll(async () => drop());

  describe('the widget API is open to any website and never uses a login', () => {
    it('answers preflight and allows any origin without credentials', async () => {
      const pre = await wid('OPTIONS', '/api/v1/widgets/alice/guestbook', undefined, { 'access-control-request-method': 'POST' });
      expect(pre.statusCode).toBe(204);
      expect(pre.headers['access-control-allow-origin']).toBe('*');
      expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
      expect((await wid('GET', '/api/v1/widgets/alice/status')).headers['access-control-allow-origin']).toBe('*');
    });
    it('ignores a session cookie, so a signed-in visitor cannot be made to act as themselves from another site', async () => {
      const r = await sign('alice', { name: 'Forged', message: 'sent from a homepage' }, { cookie: `sid=${bob.c.sid}` });
      expect(r.statusCode).toBe(201);
      const row = first(await db.query(`SELECT author_id, name FROM guestbook_entries WHERE message = 'sent from a homepage'`));
      expect(row).toEqual({ author_id: null, name: 'Forged' });
    });
    it('does not extend to the rest of the API', async () => {
      const r = await ctx.app.inject({ method: 'POST', url: '/api/v1/homes/alice/guestbook', payload: { message: 'hi' }, headers: { origin: 'https://evil.example', cookie: `sid=${bob.c.sid}` } });
      expect(r.statusCode).toBe(403);
      expect((await wid('GET', '/api/v1/me')).headers['access-control-allow-origin']).toBeUndefined();
    });
    it('serves the scripts with the right type and refuses unknown ones', async () => {
      const r = await wid('GET', '/widgets/guestbook.js');
      expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect((await wid('GET', '/widgets/nope.js')).statusCode).toBe(404);
    });
  });

  describe('guestbook', () => {
    it('lets anyone sign, and shows the entries newest first', async () => {
      expect((await sign('alice', { name: '  Zero   Cool ', url: 'example.org/hack', message: 'Great page.\r\nLove it.' })).json()).toEqual({ status: 'visible' });
      await sign('alice', { name: 'Acid Burn', message: 'Second.' });
      const list = (await wid('GET', '/api/v1/widgets/alice/guestbook')).json();
      expect(list.mode).toBe('open');
      expect(list.entries.map((e: { name: string }) => e.name)).toEqual(['Acid Burn', 'Zero Cool', 'Forged']);
      expect(list.entries[1]).toMatchObject({ url: 'http://example.org/hack', message: 'Great page.\nLove it.', member: null });
    });
    it('refuses empty and oversize input and web addresses that are not web addresses', async () => {
      expect((await sign('alice', { name: '', message: 'x' })).json().error.code).toBe('empty_name');
      expect((await sign('alice', { name: 'a', message: '  ' })).json().error.code).toBe('empty_body');
      expect((await sign('alice', { name: 'a', message: 'x'.repeat(501) })).json().error.code).toBe('message_too_long');
      expect((await sign('alice', { name: 'x'.repeat(41), message: 'x' })).json().error.code).toBe('name_too_long');
      for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org', 'http://']) {
        expect((await sign('alice', { name: 'a', message: 'x', url })).statusCode, url).toBe(400);
      }
    });
    it('stores a message as text and never as markup', async () => {
      await sign('alice', { name: '<b>bold</b>', message: '<script>alert(1)</script>' });
      const e = (await wid('GET', '/api/v1/widgets/alice/guestbook')).json().entries[0];
      expect(e).toMatchObject({ name: '<b>bold</b>', message: '<script>alert(1)</script>' }); // returned as data; scripts draw it with textContent
    });
    it('quietly drops a bot’s entry when the hidden field is filled', async () => {
      const before = first(await db.query(`SELECT count(*)::int AS n FROM guestbook_entries`)).n;
      const r = await sign('alice', { name: 'Bot', message: 'buy now', website: 'http://spam.example' });
      expect(r.statusCode).toBe(201);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM guestbook_entries`)).n).toBe(before);
    });
    it('uses the signed-in person’s own name from the site, and cannot be made to use another', async () => {
      const r = await bob.c.post('/api/v1/homes/alice/guestbook', { name: 'Someone Else', message: 'From bob, signed in.' });
      expect(r.status).toBe(201);
      const e = (await wid('GET', '/api/v1/widgets/alice/guestbook')).json().entries[0];
      expect(e).toMatchObject({ name: 'bob', member: 'bob' });
      expect((await visitor().post('/api/v1/homes/alice/guestbook', { message: 'no login' })).status).toBe(401);
    });
    it('holds entries for approval when the owner asks, and shows only what they approve', async () => {
      expect((await alice.c.patch('/api/v1/homes/me', { guestbook_mode: 'approval' })).status).toBe(204);
      expect((await sign('alice', { name: 'Newcomer', message: 'May I sign?' })).json()).toEqual({ status: 'pending' });
      expect((await wid('GET', '/api/v1/widgets/alice/guestbook')).json().entries.map((e: { name: string }) => e.name)).not.toContain('Newcomer');
      const pending = (await alice.c.get('/api/v1/homes/me/guestbook?status=pending')).body.entries;
      expect(pending.map((e: { name: string }) => e.name)).toEqual(['Newcomer']);
      expect((await bob.c.patch(`/api/v1/homes/me/guestbook/${pending[0].id}`, { status: 'visible' })).status).toBe(404); // not bob's guestbook
      expect((await alice.c.patch(`/api/v1/homes/me/guestbook/${pending[0].id}`, { status: 'visible' })).status).toBe(204);
      expect((await wid('GET', '/api/v1/widgets/alice/guestbook')).json().entries[0].name).toBe('Newcomer');
      // The owner's own entries are not held back.
      expect((await alice.c.post('/api/v1/homes/alice/guestbook', { message: 'my own note' })).status).toBe(201);
      expect((await alice.c.get('/api/v1/homes/me/guestbook?status=pending')).body.entries).toHaveLength(0);
    });
    it('lets the owner hide an entry and close the guestbook', async () => {
      const entries = (await alice.c.get('/api/v1/homes/me/guestbook')).body.entries;
      const id = entries.find((e: { name: string }) => e.name === 'Acid Burn').id;
      await alice.c.patch(`/api/v1/homes/me/guestbook/${id}`, { status: 'hidden' });
      expect((await wid('GET', '/api/v1/widgets/alice/guestbook')).json().entries.map((e: { name: string }) => e.name)).not.toContain('Acid Burn');
      await alice.c.patch('/api/v1/homes/me', { guestbook_mode: 'off' });
      expect((await sign('alice', { name: 'a', message: 'x' })).json().error.code).toBe('guestbook_closed');
      await alice.c.patch('/api/v1/homes/me', { guestbook_mode: 'open' });
    });
    it('says there is nothing there for a person with no page, a hidden page or a guest account', async () => {
      expect((await sign('nobody', { name: 'a', message: 'x' })).statusCode).toBe(404);
      await site(bob, 'index.html', '<h1>bob</h1>');
      await db.query(`UPDATE homepages SET hidden_at = now() WHERE user_id = $1`, [bob.id]);
      expect((await sign('bob', { name: 'a', message: 'x' })).statusCode).toBe(404);
      await db.query(`UPDATE homepages SET hidden_at = NULL WHERE user_id = $1`, [bob.id]);
    });
    it('limits how much one address can sign in an hour', async () => {
      ctx.deps.rateLimit = true;
      try {
        await db.query(`DELETE FROM guestbook_entries`);
        const codes: number[] = [];
        for (let i = 0; i < 7; i++) codes.push((await sign('bob', { name: `n${i}`, message: 'x' })).statusCode);
        expect(codes).toEqual([201, 201, 201, 201, 201, 429, 429]);
      } finally { ctx.deps.rateLimit = false; }
    });
  });

  describe('counter, last updated and online', () => {
    it('counts a visitor once a day, and again the next day', async () => {
      const hit = (ua = 'browser A') => wid('POST', '/api/v1/widgets/alice/hit', {}, { 'user-agent': ua }).then((r) => r.json().count);
      expect(await hit()).toBe(1);
      expect(await hit()).toBe(1);
      expect(await hit('browser B')).toBe(2);
      expect((await wid('GET', '/api/v1/widgets/alice/counter')).json()).toEqual({ count: 2 });
      ctx.clock.advance(86400);
      expect(await hit()).toBe(3);
    });
    it('reports when the page last changed and whether the person is on the site', async () => {
      const s = (await wid('GET', '/api/v1/widgets/alice/status')).json();
      expect(s.updated).not.toBeNull();
      expect(s.online).toBe(false);
      await db.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [alice.id, new Date(ctx.clock.ms - 60_000)]);
      expect((await wid('GET', '/api/v1/widgets/alice/status')).json().online).toBe(true);
      await db.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [alice.id, new Date(ctx.clock.ms - 3_600_000)]);
      expect((await wid('GET', '/api/v1/widgets/alice/status')).json().online).toBe(false);
    });
    it('gives snippets with this site’s address and the person’s handle', async () => {
      const r = (await alice.c.get('/api/v1/homes/me/snippets')).body.snippets as { id: string; html: string }[];
      expect(r.find((s) => s.id === 'guestbook')!.html).toBe('<script src="https://example.test/widgets/guestbook.js" data-user="alice"></script>');
    });
  });

  describe('directory', () => {
    beforeAll(async () => {
      await alice.c.patch('/api/v1/homes/me', { title: 'Alice’s Garden', description: 'Tomatoes and zucchini' });
      await bob.c.patch('/api/v1/homes/me', { title: 'Bob’s Bikes', description: 'Repairs' });
      const c = await person('carol'); // has a homepage row but no front page yet
      await site(c, 'notes.txt', 'x');
    });
    it('lists pages that have a front page, newest first, and can search and sort', async () => {
      const all = (await visitor().get('/api/v1/homepages')).body;
      expect(all.homepages.map((h: { handle: string }) => h.handle)).not.toContain('carol');
      expect(all.homepages.map((h: { handle: string }) => h.handle).sort()).toEqual(['alice', 'bob']);
      expect(all.homepages[0]).toMatchObject({ url: expect.stringMatching(/^https:\/\/\w+\.example-homes\.test\/$/) });
      expect((await visitor().get('/api/v1/homepages?q=zucchini')).body.homepages.map((h: { handle: string }) => h.handle)).toEqual(['alice']);
      expect((await visitor().get('/api/v1/homepages?q=BIKE')).body.homepages.map((h: { handle: string }) => h.handle)).toEqual(['bob']);
      expect((await visitor().get('/api/v1/homepages?q=%25')).body.homepages).toHaveLength(0); // a % is text, not a wildcard
      expect((await visitor().get('/api/v1/homepages?sort=name')).body.homepages.map((h: { handle: string }) => h.handle)).toEqual(['alice', 'bob']);
      expect((await visitor().get('/api/v1/homepages?limit=1')).body.next).toBe(1);
    });
    it('picks a random page and leaves out hidden ones', async () => {
      expect(['alice', 'bob']).toContain((await visitor().get('/api/v1/homepages/random')).body.handle);
      await db.query(`UPDATE homepages SET hidden_at = now() WHERE user_id = $1`, [bob.id]);
      expect((await visitor().get('/api/v1/homepages')).body.homepages.map((h: { handle: string }) => h.handle)).toEqual(['alice']);
      for (let i = 0; i < 5; i++) expect((await visitor().get('/api/v1/homepages/random')).body.handle).toBe('alice');
      await db.query(`UPDATE homepages SET hidden_at = NULL WHERE user_id = $1`, [bob.id]);
    });
  });

  describe('reports about pages and entries', () => {
    it('go to admins only, and hiding closes them', async () => {
      await sign('alice', { name: 'Reportable', message: 'something reportable' });
      const carol = await person('dave');
      const owner = await person('boardowner', 'trusted');
      const rp = await carol.c.post('/api/v1/reports', { homepage: 'alice', category: 'spam', note: 'ads' });
      expect(rp.status).toBe(201);
      expect((await carol.c.post('/api/v1/reports', { homepage: 'alice', category: 'abuse' })).body.error.code).toBe('already_reported');
      expect((await alice.c.post('/api/v1/reports', { homepage: 'alice', category: 'spam' })).body.error.code).toBe('own_post');
      expect((await carol.c.post('/api/v1/reports', { homepage: 'nobody', category: 'spam' })).status).toBe(404);
      expect((await visitor().post('/api/v1/reports', { homepage: 'alice', category: 'spam' })).status).toBe(401);
      const entry = (await wid('GET', '/api/v1/widgets/alice/guestbook')).json().entries[0];
      expect((await carol.c.post('/api/v1/reports', { guestbook_entry: entry.id, category: 'abuse' })).status).toBe(201);

      const queue = (await admin.client.get('/api/v1/reports')).body.reports as { id: string; target: { type: string; handle: string }; excerpt: string }[];
      const page = queue.find((r) => r.id === rp.body.id)!;
      expect(page).toMatchObject({ target: { type: 'homepage', handle: 'alice' }, excerpt: 'Alice’s Garden' });
      expect(queue.some((r) => r.target.type === 'guestbook' && r.excerpt.length > 0)).toBe(true);
      // A board owner has a queue for their boards, and these are not in it.
      const made = await owner.c.post('/api/v1/boards', { slug: 'x-board', name: 'xx', visibility: 'public' });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect((await owner.c.get('/api/v1/reports')).body.reports).toHaveLength(0);
      expect((await owner.c.post(`/api/v1/reports/${rp.body.id}/resolve`, { resolution: 'dismissed' })).status).toBe(404);

      expect((await admin.client.post(`/api/v1/admin/homepages/${alice.id}/hide`, { reason: 'reported ads' })).status).toBe(204);
      expect((await admin.client.post(`/api/v1/admin/homepages/${alice.id}/hide`, { reason: 'again please' })).body.error.code).toBe('no_change');
      expect((await visitor().get('/api/v1/homepages')).body.homepages.map((h: { handle: string }) => h.handle)).not.toContain('alice');
      const done = (await admin.client.get('/api/v1/reports?status=actioned')).body.reports.find((r: { id: string }) => r.id === rp.body.id);
      expect(done.resolution_note).toMatch(/Hidden by an admin/);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'homepage.hidden' AND target_id = $1`, [alice.id])).n).toBe(1);
      expect((await admin.client.post(`/api/v1/admin/homepages/${alice.id}/restore`, { reason: 'checked, fine' })).status).toBe(204);
      expect((await carol.c.post(`/api/v1/admin/homepages/${alice.id}/hide`, { reason: 'not an admin' })).status).toBe(403);

      expect((await admin.client.post(`/api/v1/admin/guestbook/${entry.id}/hide`, { reason: 'abusive' })).status).toBe(204);
      expect((await wid('GET', '/api/v1/widgets/alice/guestbook')).json().entries.map((e: { id: string }) => e.id)).not.toContain(entry.id);
    });
    it('gives admins a list of every homepage with totals', async () => {
      const r = (await admin.client.get('/api/v1/admin/homepages')).body;
      expect(r.homepages.map((h: { handle: string }) => h.handle)).toEqual(expect.arrayContaining(['alice', 'bob']));
      expect(r.totals.homepages).toBeDefined();
      expect((await admin.client.get('/api/v1/admin/homepages?hidden=true')).body.homepages).toHaveLength(0);
      expect((await alice.c.get('/api/v1/admin/homepages')).status).toBe(403);
    });
  });
});
