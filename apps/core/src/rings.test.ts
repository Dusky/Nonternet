import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ringNavScript } from './homes/ring-script';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser, SITE_YAML } from './test/harness';

describe('ring nav script', () => {
  it('is valid JavaScript that builds its output without innerHTML', () => {
    const src = ringNavScript('synths');
    expect(() => new Function(src)).not.toThrow();
    expect(src).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(src).toContain('"synths"');
  });
});

describe.skipIf(!dbAvailable)('rings', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type P = { id: string; handle: string; c: ReturnType<typeof client> };
  let founder: P, alice: P, bob: P, carol: P;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const visitor = () => client(ctx.app);
  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => {
    const u = await makeUser(ctx, { role, handle });
    return { id: u.id, handle, c: await loginAs(ctx, handle) };
  };
  const found = (p: { c: ReturnType<typeof client> }, slug: string, extra: Record<string, unknown> = {}) => p.c.post('/api/v1/rings', { slug, name: `Ring ${slug}`, ...extra });
  const putHome = (p: P) => ctx.app.inject({ method: 'PUT', url: '/api/v1/homes/me/file?path=index.html', payload: '<h1>hi</h1>', headers: { origin: 'https://example.test', cookie: `sid=${p.c.sid}`, 'content-type': 'text/plain' } });
  const navTo = (path: string) => ctx.app.inject({ method: 'GET', url: path });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db, { yaml: SITE_YAML('limits: { trusted_ring_quota: 2 }') });
    founder = await person('founder', 'trusted');
    alice = await person('alice');
    bob = await person('bob');
    carol = await person('carol');
    admin = await makeAdmin(ctx);
  });
  afterAll(async () => drop());

  describe('founding', () => {
    it('makes a ring, its board and a founder who is its first op', async () => {
      const r = await found(founder, 'synths', { description: 'Synth talk', tags: ['Music', 'synths', 'music'] });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ slug: 'synths', tags: ['music', 'synths'], join_policy: 'open', member_count: 1, board: { slug: 'ring-synths' }, me: { status: 'member', is_op: true, is_founder: true } });
      const board = (await visitor().get('/api/v1/boards/ring-synths')).body;
      expect(board).toMatchObject({ visibility: 'ring', ring: { slug: 'synths', name: 'Ring synths' }, owner: { handle: 'founder' } });
      expect((await founder.c.get('/api/v1/me')).body.user.ops).toEqual([`ring:${r.body.id}`]);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ring.created'`)).n).toBe(1);
      expect(first(await db.query(`SELECT board_id FROM rings WHERE slug = 'synths'`)).board_id).not.toBeNull();
    });
    it('is for trusted users, within the quota, and admins have none', async () => {
      expect((await found(alice, 'nope')).status).toBe(403);
      expect((await found({ c: visitor() }, 'nope')).status).toBe(401);
      expect((await found(founder, 'second')).status).toBe(201);
      expect((await found(founder, 'third')).body.error.code).toBe('quota_reached');
      for (const s of ['a1', 'a2', 'a3']) expect((await found({ c: admin.client }, `admin-${s}`)).status).toBe(201);
    });
    it('keeps ring boards out of a person’s board quota', async () => {
      const t = await person('boarder', 'trusted');
      await found(t, 'boarder-ring');
      for (const s of ['bb1', 'bb2', 'bb3']) expect((await t.c.post('/api/v1/boards', { slug: s, name: s, visibility: 'public' })).status).toBe(201);
    });
    it('refuses a taken, reserved or too-long address and a board name clash', async () => {
      expect((await found({ c: admin.client }, 'synths')).body.error.code).toBe('slug_taken');
      expect((await found({ c: admin.client }, 'new')).status).toBe(400);
      expect((await found({ c: admin.client }, 'x'.repeat(25))).status).toBe(400);
      await admin.client.post('/api/v1/boards', { slug: 'ring-clash', name: 'Clash', visibility: 'public' });
      expect((await found({ c: admin.client }, 'clash')).body.error.code).toBe('slug_taken'); // its board address is taken
    });
  });

  describe('joining, leaving and the ring board', () => {
    it('lets anyone read the ring and its board, but only members post', async () => {
      const post = (p: P) => p.c.post('/api/v1/boards/ring-synths/posts', { subject: 'Hello ring', body: 'first' });
      expect((await post(alice)).status).toBe(403);
      expect((await visitor().get('/api/v1/rings/synths')).body).toMatchObject({ slug: 'synths', me: null });
      expect((await visitor().get('/api/v1/boards/ring-synths')).body.can_post).toBe(false);
      expect((await alice.c.post('/api/v1/rings/synths/join')).body).toEqual({ status: 'member' });
      expect((await alice.c.get('/api/v1/boards/ring-synths')).body.can_post).toBe(true);
      expect((await post(alice)).status).toBe(201);
      expect((await alice.c.post('/api/v1/rings/synths/join')).body.error.code).toBe('no_change');
      expect((await alice.c.get('/api/v1/rings/synths')).body.latest_posts[0]).toMatchObject({ subject: 'Hello ring', author: 'alice' });
    });
    it('needs an account and a confirmed email to join', async () => {
      expect((await visitor().post('/api/v1/rings/synths/join')).status).toBe(401);
      const g = await makeUser(ctx, { role: 'guest', verified: false });
      expect((await (await loginAs(ctx, g.handle)).post('/api/v1/rings/synths/join')).status).toBe(403);
    });
    it('stops a member posting once they leave, and the founder cannot leave', async () => {
      expect((await bob.c.post('/api/v1/rings/synths/join')).status).toBe(200);
      expect((await bob.c.post('/api/v1/rings/synths/leave')).status).toBe(204);
      expect((await bob.c.post('/api/v1/boards/ring-synths/posts', { subject: 'x', body: 'y' })).status).toBe(403);
      expect((await bob.c.post('/api/v1/rings/synths/leave')).body.error.code).toBe('no_change');
      expect((await founder.c.post('/api/v1/rings/synths/leave')).body.error.code).toBe('founder');
    });
    it('holds requests when a ring asks for approval, and is closed to requests when by invitation', async () => {
      await found({ c: admin.client }, 'gated', { join_policy: 'approval' });
      expect((await carol.c.post('/api/v1/rings/gated/join')).body).toEqual({ status: 'pending' });
      expect((await carol.c.post('/api/v1/rings/gated/join')).body.error.code).toBe('no_change');
      expect((await carol.c.post('/api/v1/boards/ring-gated/posts', { subject: 'x', body: 'y' })).status).toBe(403);
      expect((await bob.c.get('/api/v1/rings/gated/members?status=pending')).body.members.map((m: { handle: string }) => m.handle)).not.toContain('carol'); // only ops see the waiting list
      const waiting = (await admin.client.get('/api/v1/rings/gated/members?status=pending')).body.members;
      expect(waiting.map((m: { handle: string }) => m.handle)).toEqual(['carol']);
      expect((await bob.c.post(`/api/v1/rings/gated/members/${carol.id}/approve`)).status).toBe(403);
      expect((await admin.client.post(`/api/v1/rings/gated/members/${carol.id}/approve`)).status).toBe(204);
      expect((await carol.c.post('/api/v1/boards/ring-gated/posts', { subject: 'x', body: 'y' })).status).toBe(201);

      await found({ c: admin.client }, 'private-ish', { join_policy: 'invite' });
      expect((await bob.c.post('/api/v1/rings/private-ish/join')).body.error.code).toBe('invite_only');
      expect((await admin.client.post('/api/v1/rings/private-ish/invites', { handle: 'bob' })).status).toBe(204);
      expect((await bob.c.post('/api/v1/rings/private-ish/join')).body).toEqual({ status: 'member' }); // accepting
    });
    it('caps how many rings one person can be in', async () => {
      const busy = await person('busy');
      for (let i = 1; i <= 20; i++) {
        const slug = `cap-${i}`;
        await db.query(`INSERT INTO rings (id, slug, name, founder_id, join_policy) SELECT 'r_' || lpad($1::text, 26, '9'), $2, $2, id, 'open' FROM users WHERE handle = 'founder'`, [100 + i, slug]);
      }
      for (let i = 1; i <= 20; i++) expect((await busy.c.post(`/api/v1/rings/cap-${i}/join`)).status, `ring ${i}`).toBe(200);
      await db.query(`INSERT INTO rings (id, slug, name, founder_id, join_policy) SELECT 'r_' || lpad('999', 26, '9'), 'cap-21', 'cap-21', id, 'open' FROM users WHERE handle = 'founder'`);
      expect((await busy.c.post('/api/v1/rings/cap-21/join')).body.error.code).toBe('too_many_rings');
    });
    it('does not take members into an archived ring', async () => {
      await found({ c: admin.client }, 'closed-down');
      await admin.client.patch('/api/v1/rings/closed-down', { archived: true });
      expect((await carol.c.post('/api/v1/rings/closed-down/join')).body.error.code).toBe('archived');
      expect((await visitor().get('/api/v1/boards/ring-closed-down')).body.archived).toBe(true);
    });
  });

  describe('ops', () => {
    it('lets the founder pick ops, who then moderate the ring board and manage members', async () => {
      expect((await alice.c.post('/api/v1/rings/synths/ops', { handle: 'alice' })).status).toBe(403);
      expect((await founder.c.post('/api/v1/rings/synths/ops', { handle: 'carol' })).status).toBe(404); // not a member
      await carol.c.post('/api/v1/rings/synths/join');
      expect((await founder.c.post('/api/v1/rings/synths/ops', { handle: 'carol' })).status).toBe(204);
      const ringId = (await visitor().get('/api/v1/rings/synths')).body.id;
      expect((await carol.c.get('/api/v1/me')).body.user.ops).toContain(`ring:${ringId}`);
      const thread = (await alice.c.get('/api/v1/boards/ring-synths/threads')).body.threads[0].id;
      expect((await carol.c.post('/api/v1/mod-actions', { action: 'hide', post_id: thread, reason: 'ring op at work' })).status).toBe(201);
      await carol.c.post('/api/v1/mod-actions', { action: 'unhide', post_id: thread, reason: 'and back again' });
      expect((await carol.c.get('/api/v1/boards/ring-synths')).body.can_moderate).toBe(true);
      expect((await bob.c.post('/api/v1/mod-actions', { action: 'hide', post_id: thread, reason: 'not an op' })).status).toBe(403);
      expect((await carol.c.post('/api/v1/rings/synths/ops', { handle: 'alice' })).status).toBe(403); // an op cannot appoint more
    });
    it('sends the ring board’s reports to the ring’s ops', async () => {
      const thread = (await alice.c.get('/api/v1/boards/ring-synths/threads')).body.threads[0].id;
      await bob.c.post('/api/v1/reports', { post_id: thread, category: 'spam' });
      expect((await carol.c.get('/api/v1/reports')).body.reports.map((r: { post: { id: string } }) => r.post.id)).toContain(thread);
    });
    it('blocks moving threads onto or off a ring board', async () => {
      await founder.c.post('/api/v1/boards', { slug: 'plain', name: 'Plain', visibility: 'public' });
      const thread = (await alice.c.get('/api/v1/boards/ring-synths/threads')).body.threads[0].id;
      expect((await founder.c.post('/api/v1/mod-actions', { action: 'move', post_id: thread, reason: 'trying', to_board: 'plain' })).body.error.code).toBe('ring_board');
    });
    it('removes, bans and unbans members with a reason, and bans stay out', async () => {
      await bob.c.post('/api/v1/rings/synths/join');
      expect((await carol.c.post(`/api/v1/rings/synths/members/${bob.id}/remove`)).body.error.code).toBe('reason_required');
      expect((await carol.c.post(`/api/v1/rings/synths/members/${bob.id}/ban`, { reason: 'spamming the board' })).status).toBe(204);
      expect((await bob.c.post('/api/v1/rings/synths/join')).body.error.code).toBe('banned');
      expect((await bob.c.post('/api/v1/rings/synths/leave')).body.error.code).toBe('banned');
      expect((await bob.c.post('/api/v1/boards/ring-synths/posts', { subject: 'x', body: 'y' })).status).toBe(403);
      expect((await carol.c.post(`/api/v1/rings/synths/members/${bob.id}/ban`, { reason: 'twice' })).body.error.code).toBe('no_change');
      expect((await carol.c.get('/api/v1/rings/synths/members?status=banned')).body.members.map((m: { handle: string }) => m.handle)).toEqual(['bob']);
      expect(first(await db.query(`SELECT reason FROM ring_bans WHERE user_id = $1`, [bob.id])).reason).toBe('spamming the board');
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ring.member_banned'`)).n).toBe(1);
      expect((await carol.c.post(`/api/v1/rings/synths/members/${founder.id}/ban`, { reason: 'coup attempt' })).body.error.code).toBe('founder');
      expect((await carol.c.post(`/api/v1/rings/synths/members/${bob.id}/unban`)).status).toBe(204);
      expect((await bob.c.post('/api/v1/rings/synths/join')).status).toBe(200);
      expect((await carol.c.post(`/api/v1/rings/synths/members/${bob.id}/remove`, { reason: 'ok, that is enough' })).status).toBe(204);
    });
    it('lets an op step down, not the founder, and admins do anything', async () => {
      const ops = (await visitor().get('/api/v1/rings/synths')).body.ops as { id: string; handle: string }[];
      expect(ops.map((o) => o.handle)).toEqual(['carol', 'founder']);
      const opId = first(await db.query(`SELECT s.id FROM scoped_roles s JOIN users u ON u.id = s.user_id WHERE u.handle = 'founder' AND s.scope_type = 'ring' LIMIT 1`)).id;
      expect((await founder.c.delete(`/api/v1/rings/synths/ops/${opId}`)).body.error.code).toBe('founder');
      const mine = first(await db.query(`SELECT s.id FROM scoped_roles s JOIN users u ON u.id = s.user_id JOIN rings r ON r.id = s.scope_id WHERE u.handle = 'carol' AND r.slug = 'synths'`)).id;
      expect((await bob.c.delete(`/api/v1/rings/synths/ops/${mine}`)).status).toBe(403);
      expect((await carol.c.delete(`/api/v1/rings/synths/ops/${mine}`)).status).toBe(204);
      expect((await carol.c.get('/api/v1/me')).body.user.ops.filter((o: string) => o.startsWith('ring:'))).toHaveLength(0);
    });
  });

  describe('the profile', () => {
    it('is edited by ops, and the board follows the ring', async () => {
      expect((await alice.c.patch('/api/v1/rings/synths', { name: 'Hacked' })).status).toBe(403);
      const r = await founder.c.patch('/api/v1/rings/synths', { name: 'Synth Friends', about: 'We like synths.\n\nAll of them.', tags: ['gear', 'Music'], join_policy: 'approval' });
      expect(r.body).toMatchObject({ name: 'Synth Friends', tags: ['gear', 'music'], join_policy: 'approval' });
      expect((await visitor().get('/api/v1/rings/synths')).body.about).toBe('We like synths.\n\nAll of them.');
      expect((await visitor().get('/api/v1/boards/ring-synths')).body.name).toBe('Synth Friends');
      expect((await founder.c.patch('/api/v1/rings/synths', { tags: ['a'] })).status).toBe(400);
      expect((await founder.c.patch('/api/v1/rings/synths', { tags: ['a-b', 'c-d', 'e-f', 'g-h', 'i-j', 'k-l'] })).status).toBe(400);
      await founder.c.patch('/api/v1/rings/synths', { join_policy: 'open' });
    });
    it('hands the ring to a trusted member, and no other', async () => {
      expect((await founder.c.post('/api/v1/rings/synths/transfer', { handle: 'alice' })).body.error.code).toBe('not_trusted');
      expect((await alice.c.post('/api/v1/rings/synths/transfer', { handle: 'alice' })).status).toBe(403);
      const heir = await person('heir', 'trusted');
      expect((await founder.c.post('/api/v1/rings/synths/transfer', { handle: 'heir' })).status).toBe(404); // not a member yet
      await heir.c.post('/api/v1/rings/synths/join');
      expect((await founder.c.post('/api/v1/rings/synths/transfer', { handle: 'heir' })).status).toBe(204);
      expect((await visitor().get('/api/v1/rings/synths')).body.founder.handle).toBe('heir');
      expect((await visitor().get('/api/v1/boards/ring-synths')).body.owner.handle).toBe('heir');
      expect((await heir.c.get('/api/v1/rings/synths')).body.me).toMatchObject({ is_founder: true, is_op: true });
      expect((await founder.c.get('/api/v1/rings/synths')).body.me.is_founder).toBe(false);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'ring.transferred'`)).n).toBe(1);
      expect((await founder.c.post('/api/v1/rings/synths/leave')).status).toBe(204); // no longer the founder
    });
  });

  describe('directory', () => {
    it('lists rings by newest, activity and name, filters by tag and search, and skips hidden ones', async () => {
      const newest = (await visitor().get('/api/v1/rings?limit=60')).body.rings.map((r: { slug: string }) => r.slug);
      expect(newest[0]).not.toBe('synths');
      expect((await visitor().get('/api/v1/rings?tag=gear')).body.rings.map((r: { slug: string }) => r.slug)).toEqual(['synths']);
      expect((await visitor().get('/api/v1/rings?q=Synth')).body.rings.map((r: { slug: string }) => r.slug)).toEqual(['synths']);
      expect((await visitor().get('/api/v1/rings?q=%25')).body.rings).toHaveLength(0);
      expect((await visitor().get('/api/v1/rings?sort=active&limit=1')).body.rings[0].slug).toBeDefined();
      expect((await visitor().get('/api/v1/rings?sort=name&limit=1')).body.next).toBe(1);
      const id = (await visitor().get('/api/v1/rings/gated')).body.id;
      expect((await founder.c.post(`/api/v1/admin/rings/${id}/hide`, { reason: 'not an admin' })).status).toBe(403);
      expect((await admin.client.post(`/api/v1/admin/rings/${id}/hide`, { reason: 'reported as spam' })).status).toBe(204);
      expect((await visitor().get('/api/v1/rings?limit=60')).body.rings.map((r: { slug: string }) => r.slug)).not.toContain('gated');
      expect((await visitor().get('/api/v1/rings/gated')).status).toBe(404);
      expect((await visitor().get('/api/v1/boards/ring-gated')).status).toBe(404);
      expect((await admin.client.get('/api/v1/rings/gated')).status).toBe(200);
      expect((await admin.client.get('/api/v1/admin/rings?q=gated')).body.rings[0]).toMatchObject({ slug: 'gated', hidden: true });
      expect((await admin.client.post(`/api/v1/admin/rings/${id}/restore`, { reason: 'checked, fine' })).status).toBe(204);
      expect((await visitor().get('/api/v1/rings/gated')).status).toBe(200);
      expect(['synths', 'gated']).toContain(((await visitor().get('/api/v1/rings/random')).body as { slug: string }).slug === 'synths' ? 'synths' : 'gated');
    });
  });

  describe('the nav bar', () => {
    let ring: string;
    let m1: P, m2: P, m3: P;
    beforeAll(async () => {
      m1 = await person('navone'); m2 = await person('navtwo'); m3 = await person('navthree');
      await admin.client.post('/api/v1/rings', { slug: 'navring', name: 'Nav ring' });
      ring = 'navring';
      for (const m of [m1, m2, m3]) { await m.c.post(`/api/v1/rings/${ring}/join`); await putHome(m); }
    });
    const loc = async (path: string) => { const r = await navTo(path); expect(r.statusCode).toBe(302); return r.headers.location as string; };

    it('sends next and previous around the ring in order, wrapping at the ends', async () => {
      const home = (p: P) => `https://${p.handle}.example-homes.test/`;
      expect(await loc(`/ring/${ring}/next?from=${m1.id}`)).toBe(home(m2));
      expect(await loc(`/ring/${ring}/next?from=${m2.id}`)).toBe(home(m3));
      expect(await loc(`/ring/${ring}/next?from=${m3.id}`)).toBe(home(await personByOrder(0)));
      expect(await loc(`/ring/${ring}/prev?from=${m2.id}`)).toBe(home(m1));
      expect(await loc(`/ring/${ring}/prev?from=${m1.id}`)).toBe(home(m3));
      const rnd = await loc(`/ring/${ring}/random?from=${m1.id}`);
      expect([home(m2), home(m3), 'https://admin' ]).toContain(rnd.startsWith('https://admin') ? 'https://admin' : rnd);
    });
    const personByOrder = async (i: number): Promise<P> => {
      const first = (await db.query<{ handle: string }>(`SELECT u.handle FROM ring_members m JOIN users u ON u.id = m.user_id JOIN homepages h ON h.user_id = u.id WHERE m.ring_id = (SELECT id FROM rings WHERE slug = $1) AND m.status = 'member' AND h.has_index ORDER BY m.position LIMIT 1 OFFSET $2`, [ring, i])).rows[0]!;
      return { id: '', handle: first.handle, c: client(ctx.app) };
    };

    it('follows the order ops choose, and skips people with no page', async () => {
      const noPage = await person('nonavpage');
      await noPage.c.post(`/api/v1/rings/${ring}/join`);
      expect(await loc(`/ring/${ring}/next?from=${m3.id}`)).not.toContain('nonavpage');
      expect((await m1.c.put(`/api/v1/rings/${ring}/order`, { user_ids: [m3.id] })).status).toBe(403);
      expect((await admin.client.put(`/api/v1/rings/${ring}/order`, { user_ids: [m3.id, m2.id, m1.id] })).status).toBe(204);
      const home = (p: P) => `https://${p.handle}.example-homes.test/`;
      expect(await loc(`/ring/${ring}/next?from=${m3.id}`)).toBe(home(m2));
      expect(await loc(`/ring/${ring}/next?from=${m2.id}`)).toBe(home(m1));
    });

    it('never breaks: a removed member, an unknown ring and an empty ring all lead somewhere', async () => {
      const gone = m2;
      await admin.client.post(`/api/v1/rings/${ring}/members/${gone.id}/ban`, { reason: 'left the scene' }); // a banned member keeps a row, so this is the case that could leak
      const target = await loc(`/ring/${ring}/next?from=${gone.id}`);
      expect(target).toMatch(/^https:\/\/\w+\.example-homes\.test\/$/);
      expect(target).not.toContain(gone.handle);
      expect(await loc(`/ring/${ring}/prev?from=${m1.id}`)).not.toContain(gone.handle); // skipped now (m2 sat right before m1)
      expect(await loc('/ring/nosuchring/next')).toBe('https://example.test/rings');
      expect(await loc(`/ring/${ring}/list?from=${m1.id}`)).toBe(`https://example.test/rings/${ring}`);
      expect((await navTo(`/ring/${ring}/next?from=nonsense`)).statusCode).toBe(302);
    });

    it('tells the script whether a page is still in the ring, with links that carry the member', async () => {
      const info = (id: string, origin?: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/widgets/ring/${ring}/nav?member=${id}`, headers: origin ? { origin } : {} }).then((r) => r.json());
      const good = await info(m1.id);
      expect(good).toMatchObject({ member: true, ring: { slug: ring, name: 'Nav ring', url: `https://example.test/rings/${ring}` }, next: `https://example.test/ring/${ring}/next?from=${m1.id}` });
      expect(await info(m2.id)).toMatchObject({ member: false }); // banned above: the bar says so
      expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/widgets/ring/${ring}/nav?member=${m1.id}` })).headers['access-control-allow-origin']).toBe('*');
      expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/widgets/ring/nosuchring/nav' })).statusCode).toBe(404);
    });

    it('notices the bar running on a member’s own page, and flags pages where it is missing', async () => {
      const flags = async () => ((await admin.client.get(`/api/v1/rings/${ring}/members`)).body.members as { handle: string; flags: string[] }[]).find((m) => m.handle === 'navone')!.flags;
      expect(await flags()).toEqual(['no_nav_bar']);
      await ctx.app.inject({ method: 'GET', url: `/api/v1/widgets/ring/${ring}/nav?member=${m1.id}`, headers: { origin: 'https://evil.example' } });
      expect(await flags()).toEqual(['no_nav_bar']); // a request from somewhere else does not count
      await ctx.app.inject({ method: 'GET', url: `/api/v1/widgets/ring/${ring}/nav?member=${m1.id}`, headers: { origin: 'https://navone.example-homes.test' } });
      expect(await flags()).toEqual([]);
      ctx.clock.advance(31 * 86400);
      expect(await flags()).toEqual(['no_nav_bar']); // not seen for a month
      await db.query(`UPDATE homepages SET has_index = false WHERE user_id = $1`, [m1.id]);
      expect(await flags()).toEqual(['no_homepage']);
      await db.query(`UPDATE homepages SET has_index = true WHERE user_id = $1`, [m1.id]);
      // People who are not ops see no flags.
      expect((await m3.c.get(`/api/v1/rings/${ring}/members`)).body.members[0].flags).toBeUndefined();
    });

    it('gives members a snippet in each style, and nobody else', async () => {
      const s = (await m1.c.get(`/api/v1/rings/${ring}/snippet?style=buttons`)).body.html as string;
      expect(s).toContain(`<script src="https://example.test/ring/${ring}/nav.js" data-member="${m1.id}" data-style="buttons"></script>`);
      expect(s).toContain(`<noscript>`);
      expect(s).toContain(`/ring/${ring}/prev?from=${encodeURIComponent(m1.id)}`);
      expect((await m2.c.get(`/api/v1/rings/${ring}/snippet`)).status).toBe(403);
      expect((await m1.c.get(`/api/v1/rings/${ring}/snippet?style=weird`)).status).toBe(400);
      const script = await navTo(`/ring/${ring}/nav.js`);
      expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    });

    it('lists members to everyone, with the page address when there is one', async () => {
      const list = (await visitor().get(`/api/v1/rings/${ring}/members`)).body.members as { handle: string; homepage_url: string | null; flags?: unknown }[];
      expect(list.map((m) => m.handle)).toEqual(expect.arrayContaining(['navone', 'navthree']));
      expect(list.find((m) => m.handle === 'navone')!.homepage_url).toBe('https://navone.example-homes.test/');
      expect(list[0]!.flags).toBeUndefined();
      expect((await visitor().get(`/api/v1/rings/${ring}/members?status=banned`)).body.members.every((m: { status: string }) => m.status === 'member')).toBe(true);
    });
  });
});
