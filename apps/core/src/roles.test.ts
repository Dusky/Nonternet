import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventPayloads, type EventType } from '@app/shared';
import { newId } from './crypto';
import { currentTotp } from './totp';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';

describe.skipIf(!dbAvailable)('roles, suspension, ops and the audit log', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let boss: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ctx.deps.config.security.require_admin_2fa = true; // these tests are about the site that requires it (docs/02)
    boss = await makeAdmin(ctx, 'boss');
    // Ops are granted for boards and rings that exist, so make the ones these tests use.
    for (let i = 1; i <= 50; i++) {
      await db.query(`INSERT INTO rings (id, slug, name, founder_id, join_policy) VALUES ($1, $2, $2, $3, 'open')`, [`r_${String(i).padStart(26, '0')}`, `test-ring-${i}`, boss.id]);
    }
    for (let i = 1; i <= 50; i++) {
      await db.query(`INSERT INTO boards (id, slug, name, owner_id, visibility) VALUES ($1, $2, $2, $3, 'public')`, [`b_${String(i).padStart(26, '0')}`, `test-board-${i}`, boss.id]);
    }
  });
  afterAll(async () => drop());

  const boardId = (i: number) => `b_${String(i).padStart(26, '0')}`;
  const ringId = (i: number) => `r_${String(i).padStart(26, '0')}`;
  const post = (path: string, body: unknown = {}) => boss.client.post(`/api/v1${path}`, body);
  // client.post/get only cover those verbs; DELETE goes through inject directly, as the admin.
  const del = async (userId: string, opId: string) => {
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${userId}/ops/${opId}`, headers: { origin: 'https://example.test', cookie: `sid=${boss.client.sid}` } });
    return { status: res.statusCode, body: res.json() };
  };
  const events = async (type: string, userId: string) =>
    (await db.query(`SELECT payload FROM events_outbox WHERE type = $1 AND payload->>'user_id' = $2 ORDER BY id`, [type, userId])).rows.map((r) => r.payload);
  const auditFor = async (targetId: string) => (await db.query(`SELECT * FROM audit_log WHERE target_id = $1 ORDER BY id`, [targetId])).rows;

  describe('changing a role', () => {
    it('changes the role, bumps role_rev, audits with the reason, and emits an event', async () => {
      const u = await makeUser(ctx, { role: 'user' });
      const r = await post(`/admin/users/${u.id}/role`, { role: 'trusted', reason: 'active for 2 months' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ role: 'trusted', role_rev: 1 });
      const row = first(await db.query(`SELECT role, role_rev FROM users WHERE id = $1`, [u.id]));
      expect(row).toEqual({ role: 'trusted', role_rev: 1 });

      const entry = (await auditFor(u.id)).find((a) => a.action === 'user.role_changed')!;
      expect(entry.before).toEqual({ role: 'user' });
      expect(entry.after).toEqual({ role: 'trusted', reason: 'active for 2 months' });
      expect(entry.actor_id).toBe(boss.id);
      expect(await events('user.role_changed', u.id)).toEqual([{ user_id: u.id, role: 'trusted', previous_role: 'user', role_rev: 1 }]);
    });

    it('takes effect for a session that is already logged in', async () => {
      const u = await makeUser(ctx, { role: 'user' });
      const c = await loginAs(ctx, u.handle);
      expect((await c.get('/api/v1/me')).body.user).toMatchObject({ role: 'user', role_rev: 0 });
      await post(`/admin/users/${u.id}/role`, { role: 'trusted', reason: 'promoted' });
      expect((await c.get('/api/v1/me')).body.user).toMatchObject({ role: 'trusted', role_rev: 1 });
    });

    it('needs a reason and a real role', async () => {
      const u = await makeUser(ctx);
      expect((await post(`/admin/users/${u.id}/role`, { role: 'trusted' })).status).toBe(400);
      expect((await post(`/admin/users/${u.id}/role`, { role: 'trusted', reason: 'x' })).status).toBe(400);
      expect((await post(`/admin/users/${u.id}/role`, { role: 'emperor', reason: 'because' })).status).toBe(400);
      expect(first(await db.query(`SELECT role FROM users WHERE id = $1`, [u.id])).role).toBe('user');
    });

    it('refuses to change your own role, or a change that changes nothing', async () => {
      const own = await post(`/admin/users/${boss.id}/role`, { role: 'user', reason: 'stepping down' });
      expect(own.status).toBe(409);
      expect(own.body.error.code).toBe('cannot_change_own_role');
      const u = await makeUser(ctx, { role: 'trusted' });
      expect((await post(`/admin/users/${u.id}/role`, { role: 'trusted', reason: 'same again' })).body.error.code).toBe('no_change');
    });

    it('will not make an unconfirmed address trusted or admin', async () => {
      const u = await makeUser(ctx, { role: 'guest', verified: false });
      expect((await post(`/admin/users/${u.id}/role`, { role: 'trusted', reason: 'trust them' })).body.error.code).toBe('email_not_verified');
      expect((await post(`/admin/users/${u.id}/role`, { role: 'admin', reason: 'trust them' })).body.error.code).toBe('email_not_verified');
      expect((await post(`/admin/users/${u.id}/role`, { role: 'user', reason: 'let them post' })).status).toBe(200);
    });

    it('answers 404 for an unknown or deleted user, and 400 for a malformed ID', async () => {
      expect((await post(`/admin/users/${newId('u')}/role`, { role: 'user', reason: 'no such person' })).status).toBe(404);
      const gone = await makeUser(ctx);
      await db.query(`UPDATE users SET status = 'deleted' WHERE id = $1`, [gone.id]);
      expect((await post(`/admin/users/${gone.id}/role`, { role: 'trusted', reason: 'is deleted' })).status).toBe(404);
      expect((await post(`/admin/users/not-an-id/role`, { role: 'user', reason: 'bad id' })).status).toBe(400);
    });

    it('is applied once when two admins make the same change at the same time', async () => {
      const other = await makeAdmin(ctx);
      const u = await makeUser(ctx);
      const body = { role: 'trusted', reason: 'both of us agree' };
      const results = await Promise.all([boss.client, other.client].map((c) => c.post(`/api/v1/admin/users/${u.id}/role`, body)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(first(await db.query(`SELECT role_rev FROM users WHERE id = $1`, [u.id])).role_rev).toBe(1);
      expect(await events('user.role_changed', u.id)).toHaveLength(1);
    });
  });

  describe('who may use admin calls', () => {
    const attempt = (c: ReturnType<typeof client>) => c.post('/api/v1/admin/users/' + newId('u') + '/role', { role: 'user', reason: 'testing access' });

    it('refuses anonymous callers, users and trusted users', async () => {
      expect((await attempt(client(ctx.app))).status).toBe(401);
      for (const role of ['user', 'trusted'] as const) {
        const u = await makeUser(ctx, { role });
        const r = await attempt(await loginAs(ctx, u.handle));
        expect(r.status).toBe(403);
        expect(r.body.error.code).toBe('forbidden');
      }
    });

    it('refuses someone promoted to admin mid-session until they set up two-factor', async () => {
      const u = await makeUser(ctx, { role: 'user' });
      const c = await loginAs(ctx, u.handle);
      await post(`/admin/users/${u.id}/role`, { role: 'admin', reason: 'new admin' });
      expect((await c.get('/api/v1/me')).body.user).toMatchObject({ role: 'admin', limited: true });
      expect((await attempt(c)).body.error.code).toBe('totp_setup_required');
      const setup = (await c.post('/api/v1/me/totp/setup')).body;
      ctx.clock.advance();
      expect((await c.post('/api/v1/me/totp/enable', { code: await currentTotp(setup.secret, ctx.clock.ms) })).status).toBe(200);
      expect((await attempt(c)).body.error.code).toBe('not_found'); // reached the real handler
    });

    it('takes admin power away from a demoted admin at once', async () => {
      const other = await makeAdmin(ctx);
      expect((await attempt(other.client)).body.error.code).toBe('not_found');
      await post(`/admin/users/${other.id}/role`, { role: 'user', reason: 'stepping down' });
      expect((await attempt(other.client)).body.error.code).toBe('forbidden');
    });
  });

  describe('suspension', () => {
    it('suspends: sessions end, login is refused, and it is audited and announced', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      const r = await post(`/admin/users/${u.id}/suspend`, { reason: 'spamming boards' });
      expect(r.status).toBe(204);
      expect((await c.get('/api/v1/me')).status).toBe(401);
      expect((await client(ctx.app).post('/api/v1/auth/login', { identifier: u.handle, password: TEST_PASSWORD })).body.error.code).toBe('suspended');

      const entry = (await auditFor(u.id)).find((a) => a.action === 'user.suspended')!;
      expect(entry.after).toEqual({ status: 'suspended', reason: 'spamming boards' });
      expect(await events('user.suspended', u.id)).toHaveLength(1);
      expect(await events('session.revoked', u.id)).toEqual([{ user_id: u.id, reason: 'suspended' }]);
    });

    it('unsuspends, and the user can log in again', async () => {
      const u = await makeUser(ctx);
      await post(`/admin/users/${u.id}/suspend`, { reason: 'cooling off' });
      expect((await post(`/admin/users/${u.id}/unsuspend`, { reason: 'appeal accepted' })).status).toBe(204);
      expect((await client(ctx.app).post('/api/v1/auth/login', { identifier: u.handle, password: TEST_PASSWORD })).status).toBe(200);
      expect(await events('user.unsuspended', u.id)).toHaveLength(1);
    });

    it('refuses to suspend yourself, someone already suspended, or to unsuspend an active user', async () => {
      expect((await post(`/admin/users/${boss.id}/suspend`, { reason: 'oops' })).body.error.code).toBe('cannot_suspend_self');
      const u = await makeUser(ctx);
      expect((await post(`/admin/users/${u.id}/unsuspend`, { reason: 'not suspended' })).body.error.code).toBe('no_change');
      await post(`/admin/users/${u.id}/suspend`, { reason: 'first time' });
      expect((await post(`/admin/users/${u.id}/suspend`, { reason: 'second time' })).body.error.code).toBe('no_change');
      expect((await post(`/admin/users/${u.id}/suspend`, {})).status).toBe(400); // reason required
    });
  });

  describe('ops', () => {
    it('grants an op to an ordinary user, which shows on their session and in the event', async () => {
      const u = await makeUser(ctx, { role: 'user' });
      const c = await loginAs(ctx, u.handle);
      const r = await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(1), reason: 'volunteered' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ ops: [`board:${boardId(1)}`], role_rev: 1 });
      expect(r.body.id).toMatch(/^o_[0-9A-Z]{26}$/);
      expect((await c.get('/api/v1/me')).body.user).toMatchObject({ role: 'user', ops: [`board:${boardId(1)}`], role_rev: 1 });
      expect(await events('user.ops_changed', u.id)).toEqual([{ user_id: u.id, ops: [`board:${boardId(1)}`], role_rev: 1 }]);
      const entry = (await auditFor(u.id)).find((a) => a.action === 'user.ops_changed')!;
      expect(entry.after).toMatchObject({ granted: `board:${boardId(1)}`, reason: 'volunteered' });
    });

    it('holds several ops at once, in a stable order, including channels', async () => {
      const u = await makeUser(ctx);
      await post(`/admin/users/${u.id}/ops`, { scope: 'ring', scope_id: ringId(3) });
      await post(`/admin/users/${u.id}/ops`, { scope: 'channel', scope_id: '#synths' });
      await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(2) });
      const list = await boss.client.get(`/api/v1/admin/users/${u.id}/ops`);
      expect(list.body.claims).toEqual([`board:${boardId(2)}`, 'channel:#synths', `ring:${ringId(3)}`]);
      expect(list.body.ops).toHaveLength(3);
      expect(first(await db.query(`SELECT role_rev FROM users WHERE id = $1`, [u.id])).role_rev).toBe(3);
    });

    it('checks the shape of the scope ID', async () => {
      const u = await makeUser(ctx);
      for (const bad of [
        { scope: 'board', scope_id: 'b_short' }, { scope: 'board', scope_id: ringId(1) }, { scope: 'ring', scope_id: boardId(1) },
        { scope: 'channel', scope_id: 'synths' }, { scope: 'channel', scope_id: '#Has Space' }, { scope: 'mud', scope_id: 'x' },
      ]) {
        const r = await post(`/admin/users/${u.id}/ops`, bad);
        expect(r.status, JSON.stringify(bad)).toBe(400);
      }
      expect((await boss.client.get(`/api/v1/admin/users/${u.id}/ops`)).body.claims).toEqual([]);
    });

    it('refuses a duplicate, and a suspended user', async () => {
      const u = await makeUser(ctx);
      await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(7) });
      expect((await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(7) })).body.error.code).toBe('already_op');
      expect((await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(99) })).body.error.code).toBe('not_found'); // no such board
      await post(`/admin/users/${u.id}/suspend`, { reason: 'suspended for test' });
      expect((await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(8) })).body.error.code).toBe('user_not_active');
    });

    it('revokes one op and leaves the others', async () => {
      const u = await makeUser(ctx);
      const a = (await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(10) })).body;
      await post(`/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(11) });
      const removed = await del(u.id, a.id);
      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({ ops: [`board:${boardId(11)}`], role_rev: 3 });
      expect((await auditFor(u.id)).filter((x) => x.action === 'user.ops_changed')).toHaveLength(3);
    });

    it("will not revoke another user's op, or one that is already gone", async () => {
      const a = await makeUser(ctx);
      const b = await makeUser(ctx);
      const op = (await post(`/admin/users/${a.id}/ops`, { scope: 'board', scope_id: boardId(20) })).body;
      expect((await del(b.id, op.id)).status).toBe(404);
      expect((await del(a.id, op.id)).status).toBe(200);
      expect((await del(a.id, op.id)).status).toBe(404);
    });

    it('is admin-only', async () => {
      const u = await makeUser(ctx);
      const trusted = await loginAs(ctx, (await makeUser(ctx, { role: 'trusted' })).handle);
      expect((await trusted.post(`/api/v1/admin/users/${u.id}/ops`, { scope: 'board', scope_id: boardId(30) })).status).toBe(403);
      expect((await trusted.get(`/api/v1/admin/users/${u.id}/ops`)).status).toBe(403);
    });
  });

  describe('the audit log', () => {
    it('cannot be updated, deleted or truncated, by anyone', async () => {
      await post(`/admin/users/${(await makeUser(ctx)).id}/role`, { role: 'trusted', reason: 'seed an entry' });
      await expect(db.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
      await expect(db.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
      await expect(db.query(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
      expect((await db.query(`SELECT 1 FROM audit_log`)).rowCount).toBeGreaterThan(0);
    });

    it('is written in the same transaction as the change: a rolled-back change leaves nothing', async () => {
      const before = (await db.query(`SELECT count(*)::int AS n FROM audit_log`)).rows[0]!.n;
      const u = await makeUser(ctx);
      const other = await makeAdmin(ctx);
      // both admins race to suspend; the loser is refused and must leave no audit row or event behind
      const results = await Promise.all([boss.client, other.client].map((c) => c.post(`/api/v1/admin/users/${u.id}/suspend`, { reason: 'race for the audit log' })));
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
      expect((await auditFor(u.id)).filter((a) => a.action === 'user.suspended')).toHaveLength(1);
      expect(await events('user.suspended', u.id)).toHaveLength(1);
      expect(before).toBeGreaterThan(0);
    });

    describe('reading it', () => {
      let subject: { id: string; handle: string };
      beforeAll(async () => {
        subject = await makeUser(ctx, { role: 'user' });
        await post(`/admin/users/${subject.id}/role`, { role: 'trusted', reason: 'audit test one' });
        await post(`/admin/users/${subject.id}/ops`, { scope: 'board', scope_id: boardId(40) });
        await post(`/admin/users/${subject.id}/suspend`, { reason: 'audit test two' });
      });
      const get = (qs = '') => boss.client.get(`/api/v1/admin/audit${qs}`);

      it('lists newest first, with the actor named, and never exposes the IP hash', async () => {
        const r = await get(`?target_id=${subject.id}`);
        expect(r.status).toBe(200);
        expect(r.body.entries.map((e: { action: string }) => e.action)).toEqual(['user.suspended', 'user.ops_changed', 'user.role_changed']);
        expect(r.body.entries[0]).toMatchObject({ actor_handle: 'boss', actor_kind: 'user', origin: 'web', target_type: 'user', target_id: subject.id });
        for (const e of r.body.entries) expect(e).not.toHaveProperty('ip_hash');
        expect(r.body.next_before).toBeNull();
      });

      it('filters by actor, action, action family, origin and time', async () => {
        expect((await get(`?actor=${boss.id}&target_id=${subject.id}`)).body.entries).toHaveLength(3);
        expect((await get(`?action=user.role_changed&target_id=${subject.id}`)).body.entries).toHaveLength(1);
        const family = (await get(`?action=user.*&target_id=${subject.id}`)).body.entries;
        expect(family).toHaveLength(3);
        // Only "<prefix>.*" is a family. "_" is not a wildcard: 'user.role_changed' is never matched by a
        // pattern like 'user.roleXchanged', and a bare 'user.role_*' is just an exact name that doesn't exist.
        expect((await get(`?action=user.roleXchanged&target_id=${subject.id}`)).body.entries).toHaveLength(0);
        expect((await get(`?action=user.role_*&target_id=${subject.id}`)).body.entries).toHaveLength(0);
        expect((await get(`?action=user.role.*&target_id=${subject.id}`)).body.entries).toHaveLength(0);
        expect((await get(`?origin=cli`)).body.entries.every((e: { origin: string }) => e.origin === 'cli')).toBe(true);
        const future = new Date(Date.now() + 3_600_000).toISOString();
        expect((await get(`?from=${encodeURIComponent(future)}`)).body.entries).toHaveLength(0);
        expect((await get(`?to=${encodeURIComponent(future)}&target_id=${subject.id}`)).body.entries).toHaveLength(3);
      });

      it('pages with before and next_before without gaps or repeats', async () => {
        const seen: number[] = [];
        let before: number | null | undefined;
        for (let i = 0; i < 50; i++) {
          const r = await get(`?limit=4${before ? `&before=${before}` : ''}`);
          expect(r.body.entries.length).toBeLessThanOrEqual(4);
          seen.push(...r.body.entries.map((e: { id: number }) => e.id));
          before = r.body.next_before;
          if (!before) break;
        }
        expect(before).toBeNull();
        expect(new Set(seen).size).toBe(seen.length);
        expect([...seen].sort((a, b) => b - a)).toEqual(seen);
        const total = first(await db.query(`SELECT count(*)::int AS n FROM audit_log`)).n;
        expect(seen).toHaveLength(total);
      });

      it('shows the history of one object', async () => {
        const r = await boss.client.get(`/api/v1/admin/audit/object/user/${subject.id}`);
        expect(r.body.entries.map((e: { action: string }) => e.action)).toEqual(['user.suspended', 'user.ops_changed', 'user.role_changed']);
        expect((await boss.client.get(`/api/v1/admin/audit/object/user/${newId('u')}`)).body.entries).toEqual([]);
      });

      it('rejects bad filters, caps the page size, and is admin-only', async () => {
        expect((await get('?limit=0')).status).toBe(400);
        expect((await get('?limit=500')).status).toBe(400);
        expect((await get('?from=yesterday')).status).toBe(400);
        const user = await loginAs(ctx, (await makeUser(ctx)).handle);
        expect((await user.get('/api/v1/admin/audit')).status).toBe(403);
        expect((await client(ctx.app).get('/api/v1/admin/audit')).status).toBe(401);
      });
    });
  });

  describe('events', () => {
    it('every event in the outbox is valid against its schema', async () => {
      const rows = (await db.query(`SELECT type, payload FROM events_outbox`)).rows;
      expect(rows.length).toBeGreaterThan(10);
      const kinds = new Set<string>();
      for (const r of rows) {
        expect(Object.keys(eventPayloads)).toContain(r.type);
        expect(() => eventPayloads[r.type as EventType].parse(r.payload), r.type).not.toThrow();
        kinds.add(r.type);
      }
      for (const t of ['user.created', 'user.role_changed', 'user.ops_changed', 'user.suspended', 'user.unsuspended', 'session.revoked']) expect(kinds.has(t), t).toBe(true);
    });
  });
});
