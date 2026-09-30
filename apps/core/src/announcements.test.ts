import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('announcements', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const live = async () => (await client(ctx.app).get('/api/v1/announcements')).body.announcements as { title: string }[];
  const make = (body: Record<string, unknown>) => admin.client.post('/api/v1/admin/announcements', { title: 'Maintenance', ...body });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
  });
  afterAll(async () => drop());

  it('shows a new announcement to everyone, logged in or not, straight away', async () => {
    expect(await live()).toEqual([]);
    const r = await make({ title: 'Back soon', body: 'We are moving servers tonight.', level: 'warning' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: 'Back soon', level: 'warning', state: 'live', channels: ['shell'] });
    expect((await live()).map((a) => a.title)).toEqual(['Back soon']);
    expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'announcement.created'`)).n).toBe(1);
  });

  it('is written by admins only', async () => {
    const u = await makeUser(ctx, { role: 'trusted' });
    const c = await loginAs(ctx, u.handle);
    expect((await c.post('/api/v1/admin/announcements', { title: 'Sneaky' })).status).toBe(403);
    expect((await c.get('/api/v1/admin/announcements')).status).toBe(403);
    expect((await client(ctx.app).post('/api/v1/admin/announcements', { title: 'Sneaky' })).status).toBe(401);
  });

  it('waits for its start time and disappears after its end time', async () => {
    const now = ctx.clock.ms;
    await make({ title: 'Later', starts_at: new Date(now + 3600_000).toISOString(), ends_at: new Date(now + 7200_000).toISOString() });
    expect((await live()).map((a) => a.title)).not.toContain('Later');
    expect((await admin.client.get('/api/v1/admin/announcements')).body.announcements.find((a: { title: string }) => a.title === 'Later').state).toBe('scheduled');
    ctx.clock.advance(3700);
    expect((await live()).map((a) => a.title)).toContain('Later');
    ctx.clock.advance(3600);
    expect((await live()).map((a) => a.title)).not.toContain('Later');
    expect((await admin.client.get('/api/v1/admin/announcements')).body.announcements.find((a: { title: string }) => a.title === 'Later').state).toBe('ended');
  });

  it('can be ended early, and refuses dates the wrong way round', async () => {
    const id = (await make({ title: 'Oops' })).body.id;
    expect((await admin.client.delete(`/api/v1/admin/announcements/${id}`)).status).toBe(204);
    expect((await live()).map((a) => a.title)).not.toContain('Oops');
    expect((await admin.client.delete(`/api/v1/admin/announcements/${id}`)).status).toBe(404);
    expect((await make({ starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' })).body.error.code).toBe('bad_dates');
    expect((await make({ title: 'x' })).status).toBe(400);
  });

  it('keeps announcements as plain text for the shell to draw', async () => {
    await make({ title: '<img src=x onerror=alert(1)>', body: '<script>x</script>' });
    const a = (await client(ctx.app).get('/api/v1/announcements')).body.announcements[0];
    expect(a.title).toBe('<img src=x onerror=alert(1)>'); // data, never markup: the shell draws it as text
  });
});
