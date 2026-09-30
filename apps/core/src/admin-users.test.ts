import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from './crypto';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('admin user list, dossier and invites', () => {
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

  const get = (path: string) => boss.client.get(`/api/v1${path}`);

  describe('users', () => {
    it('lists newest first, with exactly the fields the console needs and none of the secrets', async () => {
      await makeUser(ctx, { handle: 'older_one' });
      const newest = await makeUser(ctx, { handle: 'newest_one' });
      const r = await get('/admin/users');
      expect(r.status).toBe(200);
      expect(r.body.users[0].id).toBe(newest.id);
      expect(Object.keys(r.body.users[0]).sort()).toEqual(['created_at', 'display_name', 'email', 'email_verified', 'handle', 'id', 'last_seen_at', 'role', 'role_rev', 'status', 'totp_enabled']);
      expect(JSON.stringify(r.body)).not.toMatch(/password|secret|hash/i);
    });

    it('searches handle, email and display name without regard to case, and treats % and _ literally', async () => {
      const a = await makeUser(ctx, { handle: 'search_target' });
      await makeUser(ctx, { handle: 'searchXtarget' });
      await db.query(`UPDATE users SET display_name = 'Zero Cool' WHERE id = $1`, [a.id]);
      expect((await get('/admin/users?q=SEARCH_TARGET')).body.users.map((u: { handle: string }) => u.handle)).toEqual(['search_target']); // "_" is not a wildcard
      expect((await get('/admin/users?q=zero%20cool')).body.users.map((u: { id: string }) => u.id)).toEqual([a.id]);
      expect((await get(`/admin/users?q=${encodeURIComponent(a.email.toUpperCase())}`)).body.users).toHaveLength(1);
      expect((await get('/admin/users?q=%25')).body.users).toHaveLength(0); // a bare "%" matches nothing
    });

    it('filters by role and status, and hides deleted users unless asked', async () => {
      const t = await makeUser(ctx, { role: 'trusted', handle: 'a_trusted' });
      const s = await makeUser(ctx, { handle: 'a_suspended' });
      const d = await makeUser(ctx, { handle: 'a_deleted' });
      await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [s.id]);
      await db.query(`UPDATE users SET status = 'deleted' WHERE id = $1`, [d.id]);
      expect((await get('/admin/users?role=trusted')).body.users.map((u: { id: string }) => u.id)).toEqual([t.id]);
      expect((await get('/admin/users?status=suspended')).body.users.map((u: { id: string }) => u.id)).toEqual([s.id]);
      expect((await get('/admin/users?limit=200')).body.users.map((u: { id: string }) => u.id)).not.toContain(d.id);
      expect((await get('/admin/users?status=deleted')).body.users.map((u: { id: string }) => u.id)).toEqual([d.id]);
    });

    it('pages without gaps or repeats', async () => {
      for (let i = 0; i < 7; i++) await makeUser(ctx);
      const seen: string[] = [];
      let before: string | null = null;
      for (let i = 0; i < 40; i++) {
        const r: { body: { users: { id: string }[]; next_before: string | null } } = await get(`/admin/users?limit=5${before ? `&before=${before}` : ''}`);
        seen.push(...r.body.users.map((u) => u.id));
        before = r.body.next_before;
        if (!before) break;
      }
      expect(before).toBeNull();
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort().reverse()).toEqual(seen);
      expect(seen.length).toBe(first(await db.query(`SELECT count(*)::int AS n FROM users WHERE status <> 'deleted'`)).n);
    });

    it('rejects bad filters and is admin-only', async () => {
      expect((await get('/admin/users?role=emperor')).status).toBe(400);
      expect((await get('/admin/users?limit=0')).status).toBe(400);
      expect((await get('/admin/users?before=nope')).status).toBe(400);
      const user = await loginAs(ctx, (await makeUser(ctx)).handle);
      expect((await user.get('/api/v1/admin/users')).status).toBe(403);
      expect((await client(ctx.app, ctx.deps.publicUrl).get('/api/v1/admin/users')).status).toBe(401);
    });
  });

  describe('dossier', () => {
    it('shows who they are, how they got in, what they can do and what happened to them', async () => {
      const code = 'DOSS-IER0-INVT';
      await db.query(`INSERT INTO invites (code, created_by, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [code, boss.id]);
      const signup = await client(ctx.app, ctx.deps.publicUrl).post('/api/v1/auth/signup', { handle: 'dossier_subject', email: 'subject@example.test', password: 'correct horse battery', invite: code, age_confirmed: true });
      expect(signup.status).toBe(201);
      const id = signup.body.id as string;
      await boss.client.post(`/api/v1/admin/users/${id}/role`, { role: 'user', reason: 'let them post' });
      await boss.client.post(`/api/v1/admin/users/${id}/ops`, { scope: 'channel', scope_id: '#synths', reason: 'volunteer' });

      const r = await get(`/admin/users/${id}`);
      expect(r.status).toBe(200);
      expect(r.body.user).toMatchObject({ id, handle: 'dossier_subject', email: 'subject@example.test', role: 'user', status: 'active', email_verified: false, totp_enabled: false });
      expect(r.body.invite).toEqual({ code, created_by: 'boss' });
      expect(r.body.ops).toHaveLength(1);
      expect(r.body.ops[0]).toMatchObject({ scope: 'channel', scope_id: '#synths' });
      expect(r.body.active_sessions).toBe(0);
      expect(r.body.history.map((h: { action: string }) => h.action)).toEqual(['user.ops_changed', 'user.role_changed', 'user.created']);
      expect(JSON.stringify(r.body)).not.toMatch(/password_hash|totp_secret|token_hash/i);
    });

    it('counts live sessions and remaining recovery codes', async () => {
      expect((await get(`/admin/users/${boss.id}`)).body).toMatchObject({ recovery_codes_remaining: 10, active_sessions: 1 });
      const u = await makeUser(ctx);
      await loginAs(ctx, u.handle); await loginAs(ctx, u.handle);
      expect((await get(`/admin/users/${u.id}`)).body.active_sessions).toBe(2);
    });

    it('answers 404 for an unknown user, 400 for a malformed ID, and refuses non-admins', async () => {
      expect((await get(`/admin/users/${newId('u')}`)).status).toBe(404);
      expect((await get('/admin/users/xyz')).status).toBe(400);
      const user = await loginAs(ctx, (await makeUser(ctx)).handle);
      expect((await user.get(`/api/v1/admin/users/${boss.id}`)).status).toBe(403);
    });
  });

  describe('invites', () => {
    it('lists them newest first with who made and who used each, and their state', async () => {
      const used = await makeUser(ctx, { handle: 'invite_user' });
      await db.query(`INSERT INTO invites (code, created_by, used_by, used_at, expires_at, created_at) VALUES ('INV-USED', $1, $2, now(), now() + interval '1 day', now() - interval '3 minutes')`, [boss.id, used.id]);
      await db.query(`INSERT INTO invites (code, created_by, expires_at, created_at) VALUES ('INV-OPEN', $1, now() + interval '1 day', now() - interval '2 minutes')`, [boss.id]);
      await db.query(`INSERT INTO invites (code, created_by, expires_at, created_at) VALUES ('INV-OLD', $1, now() - interval '1 hour', now() - interval '1 minute')`, [boss.id]);
      const r = (await get('/admin/invites')).body.invites as { code: string; status: string; created_by: string; used_by: string | null }[];
      const byCode = Object.fromEntries(r.map((i) => [i.code, i]));
      expect(byCode['INV-USED']).toMatchObject({ status: 'used', used_by: 'invite_user', created_by: 'boss' });
      expect(byCode['INV-OPEN']).toMatchObject({ status: 'open', used_by: null });
      expect(byCode['INV-OLD']!.status).toBe('expired');
      const order = r.map((i) => i.code).filter((c) => c.startsWith('INV-'));
      expect(order).toEqual(['INV-OLD', 'INV-OPEN', 'INV-USED']);
    });

    it('is admin-only', async () => {
      const user = await loginAs(ctx, (await makeUser(ctx)).handle);
      expect((await user.get('/api/v1/admin/invites')).status).toBe(403);
    });
  });
});
