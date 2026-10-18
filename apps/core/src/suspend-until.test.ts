import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liftExpiredSuspensions } from './admin';
import { client, createTestDb, dbAvailable, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';

// Suspensions with an end date, and admin notes (docs/11, docs/17 2026-10-18).
describe.skipIf(!dbAvailable)('suspensions that end and admin notes', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let boss: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    boss = await makeAdmin(ctx, 'boss');
  });
  afterAll(async () => drop());

  const login = (handle: string) => client(ctx.app, ctx.deps.publicUrl).post('/api/v1/auth/login', { identifier: handle, password: TEST_PASSWORD });

  it('suspends for a number of days, says when it ends, and lifts itself when the time passes', async () => {
    const u = await makeUser(ctx);
    expect((await boss.client.post(`/api/v1/admin/users/${u.id}/suspend`, { reason: 'Cooling off', days: 7 })).status).toBe(204);
    const r = await login(u.handle);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/suspended until \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
    const dossier = (await boss.client.get(`/api/v1/admin/users/${u.id}`)).body;
    expect(Date.parse(dossier.user.suspended_until) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

    // Not yet due: nothing happens.
    expect(await liftExpiredSuspensions(ctx.deps)).toBe(0);
    await db.query(`UPDATE users SET suspended_until = now() - interval '1 minute' WHERE id = $1`, [u.id]);
    expect(await liftExpiredSuspensions(ctx.deps)).toBe(1);
    expect((await login(u.handle)).status).toBe(200);
    const a = await db.query(`SELECT actor_kind, origin FROM audit_log WHERE action = 'user.unsuspended' AND target_id = $1`, [u.id]);
    expect(a.rows).toEqual([{ actor_kind: 'system', origin: 'system' }]);
    const ev = await db.query(`SELECT 1 FROM events_outbox WHERE type = 'user.unsuspended' AND payload->>'user_id' = $1`, [u.id]);
    expect(ev.rows.length).toBeGreaterThan(0);
  });

  it('without days it lasts until lifted, and lifting clears the date', async () => {
    const u = await makeUser(ctx);
    await boss.client.post(`/api/v1/admin/users/${u.id}/suspend`, { reason: 'Spam' });
    expect((await login(u.handle)).body.error.message).toBe('This account is suspended. Contact the admins to appeal.');
    await db.query(`UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = $1`, [u.id]);
    await boss.client.post(`/api/v1/admin/users/${u.id}/unsuspend`, { reason: 'Sorted' });
    expect((await db.query(`SELECT suspended_until FROM users WHERE id = $1`, [u.id])).rows[0].suspended_until).toBeNull();
  });

  it('refuses other lengths', async () => {
    const u = await makeUser(ctx);
    expect((await boss.client.post(`/api/v1/admin/users/${u.id}/suspend`, { reason: 'x', days: 3 })).status).toBe(400);
  });

  it('keeps notes for admins only, audited, and deletes them with the account', async () => {
    const u = await makeUser(ctx);
    const added = await boss.client.post(`/api/v1/admin/users/${u.id}/notes`, { body: '  Asked about the rules twice.  ' });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ body: 'Asked about the rules twice.', author: 'boss' });
    expect((await boss.client.get(`/api/v1/admin/users/${u.id}/notes`)).body.notes).toHaveLength(1);
    expect((await boss.client.post(`/api/v1/admin/users/${u.id}/notes`, { body: '   ' })).status).toBe(400);
    const other = await makeUser(ctx);
    const c = client(ctx.app, ctx.deps.publicUrl);
    await c.post('/api/v1/auth/login', { identifier: other.handle, password: TEST_PASSWORD });
    expect((await c.get(`/api/v1/admin/users/${u.id}/notes`)).status).toBe(403);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'user.note_added' AND target_id = $1`, [u.id])).rows).toHaveLength(1);
    expect((await boss.client.post(`/api/v1/admin/users/${u.id}/delete`, { reason: 'Asked by email', posts: 'keep' })).status).toBe(204);
    expect((await db.query(`SELECT 1 FROM admin_notes WHERE user_id = $1`, [u.id])).rows).toHaveLength(0);
  });
});
