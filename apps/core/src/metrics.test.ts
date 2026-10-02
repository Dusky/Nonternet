import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectMetrics, getStatus, series } from './metrics';
import { summary } from './backups';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('status board and metrics', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
    const u = await makeUser(ctx, { role: 'trusted', handle: 'poster' });
    const c = await loginAs(ctx, u.handle);
    await c.post('/api/v1/boards', { slug: 'general', name: 'General', visibility: 'public' });
    await c.post('/api/v1/boards/general/posts', { subject: 'One', body: 'x' });
    await c.post('/api/v1/boards/general/posts', { subject: 'Two', body: 'y' });
  });
  afterAll(async () => drop());

  it('is for admins only', async () => {
    const u = await makeUser(ctx, { role: 'trusted' });
    const c = await loginAs(ctx, u.handle);
    for (const path of ['/api/v1/admin/status', '/api/v1/admin/metrics?metric=posts', '/api/v1/admin/backups']) {
      expect((await c.get(path)).status, path).toBe(403);
      expect((await client(ctx.app).get(path)).status, path).toBe(401);
    }
  });

  it('shows what is going on right now', async () => {
    const s = (await admin.client.get('/api/v1/admin/status')).body;
    expect(s.db.ok).toBe(true);
    expect(s.counts).toMatchObject({ posts_24h: 2, boards: 1, users: { new_24h: expect.any(Number) }, reports: { open: 0, escalated: 0 } });
    expect(s.counts.users.total).toBeGreaterThanOrEqual(3);
    expect(s.redis).toEqual({ configured: false, ok: false, ms: null }); // no Redis in the test app
    expect(s.disk.homes.total_bytes).toBeGreaterThan(0);
    expect(s.outbox.backlog).toBeGreaterThan(0); // nothing publishes in the tests, so events wait
    expect(s.uptime_s).toBeGreaterThanOrEqual(0);
  });

  it('does not warn about a backup or restore test on a site that has only just started', async () => {
    const s = (await admin.client.get('/api/v1/admin/status')).body;
    expect(s.warnings).not.toContain('backup_overdue');
    expect(s.warnings).not.toContain('restore_test_overdue');
    expect(s.backups).toMatchObject({ lastBackup: null, backupOverdue: false, backupGrace: true, lastRestoreTest: null, restoreTestOverdue: false, restoreTestGrace: true });
  });

  it('warns about overdue backups and restore tests once the site is past its first days, then calms down once they are recent', async () => {
    const t0 = ctx.clock.ms; // put the clock back at the end: later tests compare it with database time
    await db.query(`UPDATE users SET created_at = created_at - interval '30 days'`);
    let s = (await admin.client.get('/api/v1/admin/status')).body;
    expect(s.backups).toMatchObject({ backupGrace: false, restoreTestGrace: false });
    expect(s.warnings).toEqual(expect.arrayContaining(['backup_overdue', 'restore_test_overdue']));
    await db.query(`UPDATE users SET created_at = created_at + interval '29 days'`); // 1 day old: backup still inside its 2 days, restore test too
    expect(((await admin.client.get('/api/v1/admin/status')).body.warnings as string[]).filter((w) => w.endsWith('_overdue'))).toEqual([]);
    await db.query(`UPDATE users SET created_at = created_at - interval '29 days'`);
    await db.query(`INSERT INTO backup_runs (id, kind, status, started_at, finished_at, size_bytes) VALUES ('bk_a', 'backup', 'ok', $1, $1, 1234), ('bk_b', 'restore_test', 'ok', $1, $1, NULL)`, [new Date(ctx.clock.ms - 3600_000)]);
    s = (await admin.client.get('/api/v1/admin/status')).body;
    expect(s.warnings).not.toContain('backup_overdue');
    expect(s.warnings).not.toContain('restore_test_overdue');
    expect(s.backups).toMatchObject({ lastBackup: { size_bytes: 1234 }, lastRestoreTest: { ok: true } });
    ctx.clock.advance(27 * 3600);
    expect((await summary(ctx.deps)).backupOverdue).toBe(true); // a day later with no new backup
    ctx.clock.advance(36 * 86400);
    expect((await summary(ctx.deps)).restoreTestOverdue).toBe(true);
    ctx.clock.ms = t0;
  });

  it('counts a failed restore test as overdue even though one was recorded', async () => {
    await db.query(`DELETE FROM backup_runs`);
    await db.query(`INSERT INTO backup_runs (id, kind, status, started_at, finished_at) VALUES ('bk_c', 'restore_test', 'failed', $1, $1)`, [new Date(ctx.clock.ms - 3600_000)]);
    const s = await summary(ctx.deps);
    expect(s.lastRestoreTest).toMatchObject({ ok: false });
    expect(s.restoreTestOverdue).toBe(true);
  });

  it('warns about a growing event backlog, waiting reports and failing exports', async () => {
    const u = await makeUser(ctx, { handle: 'reporter' });
    const c = await loginAs(ctx, u.handle);
    const t = (await admin.client.post('/api/v1/boards/general/posts', { subject: 'Reportable', body: 'z' })).body.id;
    await c.post('/api/v1/reports', { post_id: t, category: 'spam' });
    expect((await getStatus(ctx.deps)).counts.reports).toEqual({ open: 1, escalated: 0 });
    const t1 = ctx.clock.ms;
    ctx.clock.advance(25 * 3600);
    expect((await getStatus(ctx.deps)).warnings).toContain('reports_waiting');
    ctx.clock.ms = t1;
    await db.query(`UPDATE events_outbox SET created_at = now() - interval '20 minutes' WHERE id = (SELECT min(id) FROM events_outbox)`);
    expect((await getStatus(ctx.deps)).warnings).toContain('outbox_backlog');
  });

  describe('hourly numbers', () => {
    it('counts what happened in each hour, and doing it again gives the same answer', async () => {
      await collectMetrics(ctx.deps, 2);
      const a = await series(ctx.deps, 'posts', 6);
      const total = a.points.reduce((n, p) => n + p.value, 0);
      expect(a.points).toHaveLength(6);
      expect(total).toBeGreaterThanOrEqual(2);
      await collectMetrics(ctx.deps, 2);
      expect((await series(ctx.deps, 'posts', 6)).points.reduce((n, p) => n + p.value, 0)).toBe(total);
      expect(new Date(a.points[5]!.at).getUTCMinutes()).toBe(0);
    });
    it('takes a reading of things like users and the event backlog', async () => {
      await collectMetrics(ctx.deps, 1);
      const users = await series(ctx.deps, 'users', 3);
      expect(users.points.at(-1)!.value).toBeGreaterThanOrEqual(3);
      expect((await series(ctx.deps, 'outbox_backlog', 1)).points[0]!.value).toBeGreaterThan(0);
    });
    it('serves a series over the API and refuses a metric it does not know', async () => {
      const r = await admin.client.get('/api/v1/admin/metrics?metric=signups&hours=24');
      expect(r.status).toBe(200);
      expect(r.body.points).toHaveLength(24);
      expect((await admin.client.get('/api/v1/admin/metrics?metric=nonsense')).status).toBe(400);
      expect((await admin.client.get('/api/v1/admin/metrics?metric=posts&hours=99999')).status).toBe(400);
    });
    it('forgets numbers older than 90 days', async () => {
      await db.query(`INSERT INTO metrics_rollup (metric, bucket, value) VALUES ('posts', now() - interval '100 days', 7)`);
      await collectMetrics(ctx.deps, 1);
      expect((await db.query(`SELECT 1 FROM metrics_rollup WHERE bucket < now() - interval '95 days'`)).rowCount).toBe(0);
    });
  });
});
