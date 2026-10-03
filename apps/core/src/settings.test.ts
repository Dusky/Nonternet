import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';
import { en } from '@app/strings';
import { loadSettings, SETTINGS } from './settings';

describe.skipIf(!dbAvailable)('versioned settings', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const put = (key: string, value: unknown, extra: Record<string, unknown> = {}) => admin.client.put(`/api/v1/admin/settings/${key}`, { value, reason: 'testing the setting', ...extra });
  const one = async (key: string) => (await admin.client.get('/api/v1/admin/settings')).body.settings.find((s: { key: string }) => s.key === key);

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
  });
  afterAll(async () => drop());

  it('lists what can be changed, with the file’s value and the site name and domains as read-only', async () => {
    const r = (await admin.client.get('/api/v1/admin/settings')).body;
    expect(r.settings.map((s: { key: string }) => s.key)).toContain('limits.trusted_board_quota');
    expect(await one('limits.trusted_board_quota')).toMatchObject({ value: 3, default: 3, overridden: false, version: 0, risky: false });
    expect(r.readonly).toMatchObject({ name: 'Test Site', domain: 'example.test' });
    expect(JSON.stringify(r.settings.map((s: { key: string }) => s.key))).not.toMatch(/site\./); // the name and domains are not settings
  });

  it('has a label in the UI strings for every setting', () => {
    expect(SETTINGS.filter((s) => !(`setting.${s.key}` in en)).map((s) => s.key)).toEqual([]);
  });

  it('is for admins only', async () => {
    const u = await makeUser(ctx, { role: 'trusted' });
    const c = await loginAs(ctx, u.handle);
    expect((await c.get('/api/v1/admin/settings')).status).toBe(403);
    expect((await c.put('/api/v1/admin/settings/limits.trusted_board_quota', { value: 9, reason: 'no' })).status).toBe(403);
    expect((await client(ctx.app).get('/api/v1/admin/settings')).status).toBe(401);
  });

  it('changes a setting at once, records who and why, and audits it', async () => {
    const r = await put('limits.trusted_board_quota', 1);
    expect(r.body).toEqual({ changed: true, version: 1 });
    expect(ctx.deps.config.limits.trusted_board_quota).toBe(1);
    expect(await one('limits.trusted_board_quota')).toMatchObject({ value: 1, default: 3, overridden: true, version: 1, updated_by: admin.handle });
    // ...and it takes effect: a trusted user can now own one board and not two.
    const t = await makeUser(ctx, { role: 'trusted' });
    const tc = await loginAs(ctx, t.handle);
    expect((await tc.post('/api/v1/boards', { slug: 'first-b', name: 'First', visibility: 'public' })).status).toBe(201);
    expect((await tc.post('/api/v1/boards', { slug: 'second-b', name: 'Second', visibility: 'public' })).body.error.code).toBe('quota_reached');
    const a = first(await db.query(`SELECT before, after FROM audit_log WHERE action = 'settings.changed' AND target_id = 'limits.trusted_board_quota'`));
    expect(a.before).toEqual({ value: 3 });
    expect(a.after).toMatchObject({ value: 1, reason: 'testing the setting' });
  });

  it('needs a reason, and refuses values that are not allowed', async () => {
    expect((await admin.client.put('/api/v1/admin/settings/limits.trusted_ring_quota', { value: 5 })).status).toBe(400);
    for (const value of [-1, 101, 2.5, 'lots', null as unknown]) {
      if (value === null) continue;
      expect((await put('limits.trusted_ring_quota', value)).status, String(value)).toBe(400);
    }
    expect((await put('signup.mode', 'closed', { confirm: true })).status).toBe(400);
    expect((await put('site.name', 'Hijacked')).status).toBe(404);
    expect((await put('limits.trusted_board_quota', 1)).body.error.code).toBe('no_change');
  });

  it('previews a risky change first and only makes it when confirmed', async () => {
    const preview = await put('limits.homepage_quota_mb.user', 5);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ pending: true, current: 50, next: 5, impact: { affected: 0 } });
    expect(ctx.deps.config.limits.homepage_quota_mb.user).toBe(50); // nothing changed yet
    expect(first(await db.query(`SELECT count(*)::int AS n FROM settings_history WHERE key = 'limits.homepage_quota_mb.user'`)).n).toBe(0);
    expect((await put('limits.homepage_quota_mb.user', 5, { confirm: true })).body).toEqual({ changed: true, version: 1 });
    expect(ctx.deps.config.limits.homepage_quota_mb.user).toBe(5);
  });

  it('says how many people a lower limit would touch', async () => {
    const u = await makeUser(ctx, { handle: 'bigpage' });
    await db.query(`INSERT INTO homepages (user_id, size_bytes) VALUES ($1, $2)`, [u.id, 3 * 1048576]);
    const preview = await put('limits.homepage_quota_mb.user', 2);
    expect(preview.body.impact).toMatchObject({ affected: 1, note: expect.stringContaining('keep their files') });
  });

  it('keeps related settings consistent', async () => {
    expect((await put('limits.homepage_quota_mb.user', 500, { confirm: true })).status).toBe(400); // more than trusted users get
    expect((await put('limits.homepage_quota_mb.trusted', 1, { confirm: true })).status).toBe(400); // less than users get
  });

  it('keeps every version, and brings an old one back as a new version', async () => {
    await put('limits.trusted_ring_quota', 4);
    await put('limits.trusted_ring_quota', 6);
    const h = (await admin.client.get('/api/v1/admin/settings/limits.trusted_ring_quota/history')).body.history;
    expect(h.map((x: { version: number; value: unknown; previous: unknown }) => [x.version, x.previous, x.value])).toEqual([[2, 4, 6], [1, 2, 4]]);
    expect(h[0]).toMatchObject({ by: admin.handle, reason: 'testing the setting' });
    const back = await admin.client.post('/api/v1/admin/settings/limits.trusted_ring_quota/rollback', { version: 1, reason: 'six was too many' });
    expect(back.body).toEqual({ changed: true, version: 3 });
    expect(ctx.deps.config.limits.trusted_ring_quota).toBe(4);
    const h2 = (await admin.client.get('/api/v1/admin/settings/limits.trusted_ring_quota/history')).body.history;
    expect(h2[0]).toMatchObject({ version: 3, value: 4, rolled_back_to: 1, reason: 'six was too many' });
    expect((await admin.client.post('/api/v1/admin/settings/limits.trusted_ring_quota/rollback', { version: 1, reason: 'again please' })).body.error.code).toBe('no_change');
    expect((await admin.client.post('/api/v1/admin/settings/limits.trusted_ring_quota/rollback', { version: 99, reason: 'nothing there' })).status).toBe(404);
  });

  it('can go back to the config file’s value', async () => {
    const r = await admin.client.put('/api/v1/admin/settings/limits.trusted_ring_quota', { value: null, reason: 'use the file again' });
    expect(r.body.changed).toBe(true);
    expect(ctx.deps.config.limits.trusted_ring_quota).toBe(2);
    expect(await one('limits.trusted_ring_quota')).toMatchObject({ value: 2, overridden: false });
  });

  it('loads saved values when the server starts', async () => {
    const other = await makeApp(db); // a fresh server on the same database, with the file's values
    expect(other.deps.config.limits.trusted_board_quota).toBe(3);
    await loadSettings(other.deps);
    expect(other.deps.config.limits.trusted_board_quota).toBe(1);
    expect(other.deps.config.limits.trusted_ring_quota).toBe(2); // reset to the file, so nothing saved
    expect(other.deps.config.limits.homepage_quota_mb.user).toBe(5);
  });
});
