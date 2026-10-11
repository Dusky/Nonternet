import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasAdmin } from './setup';
import { client, createTestDb, dbAvailable, makeAdmin, makeApp } from './test/harness';

// The installer's web finish (docs/19): the setup link makes the first admin, once.
describe.skipIf(!dbAvailable)('first-admin setup from the browser', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  const TOKEN = 'a-long-random-setup-token-from-the-installer';
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());
  const body = (o: object = {}) => ({ token: TOKEN, handle: 'firstadmin', email: 'first@example.test', password: 'a good long password', ...o });

  it('is closed when the installer gave no token', async () => {
    expect(await hasAdmin(ctx.deps)).toBe(false); // what `cli has-admin` reports to sitectl install
    const c = client(ctx.app);
    expect((await c.get('/api/v1/setup')).body).toEqual({ needed: false });
    expect((await c.post('/api/v1/setup', body())).status).toBe(410);
  });

  it('needs the right token, makes the first admin, signs them in, is audited, and then closes', async () => {
    ctx.deps.setupToken = TOKEN;
    const c = client(ctx.app);
    expect((await c.get('/api/v1/setup')).body).toEqual({ needed: true });
    expect((await c.post('/api/v1/setup', body({ token: 'wrong' }))).status).toBe(403);
    expect((await c.post('/api/v1/setup', body({ handle: 'admin' }))).status).toBe(400); // a reserved handle
    expect((await c.post('/api/v1/setup', body({ password: 'short' }))).status).toBe(400);
    const r = await c.post('/api/v1/setup', body());
    expect(r.status).toBe(201);
    const me = (await c.get('/api/v1/me')).body;
    expect(me.user ?? me).toMatchObject({ handle: 'firstadmin', role: 'admin' });
    const log = await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action = 'site.setup_finished'`);
    expect(log.rowCount).toBe(1);
    expect(await hasAdmin(ctx.deps)).toBe(true);
    // Closed for good: the same link does nothing now.
    expect((await client(ctx.app).get('/api/v1/setup')).body).toEqual({ needed: false });
    expect((await client(ctx.app).post('/api/v1/setup', body({ handle: 'second', email: 'second@example.test' }))).status).toBe(410);
  });

  it('stays closed on a site that already has an admin', async () => {
    const t = await createTestDb(); const app2 = await makeApp(t.db);
    await makeAdmin(app2);
    app2.deps.setupToken = TOKEN;
    expect((await client(app2.app).get('/api/v1/setup')).body).toEqual({ needed: false });
    expect((await client(app2.app).post('/api/v1/setup', body())).status).toBe(410);
    await t.drop();
  });
});
