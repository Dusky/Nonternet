import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHomesApp } from './homes/server';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('changing a handle', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: Awaited<ReturnType<typeof buildHomesApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  let alice: { id: string; handle: string; c: ReturnType<typeof client> };
  const rename = (id: string, handle: string, by = admin.client) => by.post(`/api/v1/admin/users/${id}/rename`, { handle, reason: 'asked nicely' });
  const home = (host: string, url = '/') => server.inject({ method: 'GET', url, headers: { host } });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    server = await buildHomesApp(ctx.deps);
    admin = await makeAdmin(ctx);
    const u = await makeUser(ctx, { handle: 'alice' });
    alice = { id: u.id, handle: 'alice', c: await loginAs(ctx, 'alice') };
    await ctx.app.inject({ method: 'PUT', url: '/api/v1/homes/me/file?path=index.html', payload: '<h1>alice</h1>', headers: { origin: 'https://example.test', cookie: `sid=${alice.c.sid}`, 'content-type': 'text/plain' } });
  });
  afterAll(async () => { await server.close(); await drop(); });

  it('renames, bumps the role revision, audits and tells the bus', async () => {
    const before = first(await db.query(`SELECT role_rev FROM users WHERE id = $1`, [alice.id])).role_rev;
    const r = await rename(alice.id, 'alicia');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ handle: 'alicia', role_rev: before + 1 });
    expect((await alice.c.get('/api/v1/me')).body.user).toMatchObject({ handle: 'alicia', role_rev: before + 1 });
    const a = first(await db.query(`SELECT before, after, actor_id FROM audit_log WHERE action = 'user.renamed' AND target_id = $1`, [alice.id]));
    expect(a.before).toEqual({ handle: 'alice' });
    expect(a.after).toMatchObject({ handle: 'alicia', reason: 'asked nicely' });
    expect(first(await db.query(`SELECT payload FROM events_outbox WHERE type = 'user.renamed'`)).payload).toMatchObject({ handle: 'alicia', previous_handle: 'alice' });
    expect((await alice.c.post('/api/v1/auth/login', { identifier: 'alicia', password: 'correct horse battery' })).status).toBe(200);
  });

  it('moves the homepage address and redirects the old one', async () => {
    expect((await home('alicia.example-homes.test')).body).toContain('<h1>alice</h1>');
    const old = await home('alice.example-homes.test', '/docs/?x=1');
    expect(old.statusCode).toBe(301);
    expect(old.headers.location).toBe('https://alicia.example-homes.test/docs/?x=1');
    // Files are keyed by ID, so nothing moved on disk.
    expect(ctx.deps.homes.dir(alice.id)).toContain(alice.id);
  });

  it('keeps redirecting through a second rename, and stops after 90 days', async () => {
    expect((await rename(alice.id, 'alison')).status).toBe(200);
    expect((await home('alice.example-homes.test')).headers.location).toBe('https://alison.example-homes.test/');
    expect((await home('alicia.example-homes.test')).headers.location).toBe('https://alison.example-homes.test/');
    await db.query(`UPDATE handle_history SET changed_at = now() - interval '91 days' WHERE handle = 'alice'`);
    expect((await home('alice.example-homes.test')).statusCode).toBe(404);
    expect((await home('alicia.example-homes.test')).statusCode).toBe(301);
  });

  it('holds the old handle for its owner: nobody can sign up with it or rename to it for 90 days', async () => {
    const bob = await makeUser(ctx, { handle: 'bob' });
    expect((await rename(bob.id, 'alicia')).body.error.code).toBe('handle_unavailable');
    expect((await rename(alice.id, 'alicia')).status).toBe(200); // the owner can take it back
    const inv = (await admin.client.post('/api/v1/admin/invites', {})).body.code;
    const s = await client(ctx.app).post('/api/v1/auth/signup', { handle: 'alison', email: 'x@example.test', password: 'correct horse battery', invite: inv, age_confirmed: true });
    expect(s.status).toBe(409);
    expect(s.body.error.code).toBe('handle_unavailable');
    // Once the 90 days are up, it is free again.
    await db.query(`UPDATE handle_history SET changed_at = now() - interval '91 days'`);
    expect((await rename(bob.id, 'alison')).status).toBe(200);
  });

  it('refuses a bad, reserved, taken, unchanged or unauthorised rename', async () => {
    const carol = await makeUser(ctx, { handle: 'carol' });
    expect((await rename(carol.id, 'x')).status).toBe(400);
    expect((await rename(carol.id, 'has space')).status).toBe(400);
    expect((await rename(carol.id, 'admin')).body.error.code).toBe('handle_unavailable'); // reserved
    expect((await rename(carol.id, 'ALICIA')).body.error.code).toBe('handle_unavailable'); // taken, ignoring case
    expect((await rename(carol.id, 'carol')).body.error.code).toBe('no_change');
    expect((await rename(carol.id, 'carol2', alice.c)).status).toBe(403);
    expect((await rename('u_00000000000000000000000000', 'nobody')).status).toBe(404);
  });

  it('lets only the case of a handle change without leaving a redirect', async () => {
    const dana = await makeUser(ctx, { handle: 'dana' });
    expect((await rename(dana.id, 'Dana')).status).toBe(200);
    expect(first(await db.query(`SELECT count(*)::int AS n FROM handle_history WHERE user_id = $1`, [dana.id])).n).toBe(0);
    expect((await home('dana.example-homes.test')).statusCode).toBe(404); // no page yet, and no redirect loop either
  });
});
