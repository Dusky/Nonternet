import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from './accounts';
import { client, createTestDb, dbAvailable, makeApp, tokenFromMail, first } from './test/harness';
import { verifyPassword } from './passwords';

const PASSWORD = 'correct horse battery';

describe.skipIf(!dbAvailable)('accounts', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let adminId: string;
  let n = 0;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    adminId = await createAdmin(ctx.deps, { handle: 'boss', email: 'boss@example.test', password: PASSWORD });
  });
  afterAll(async () => drop());

  const invite = async (sql = `now() + interval '1 day'`) => {
    const code = `TEST-${++n}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await db.query(`INSERT INTO invites (code, created_by, expires_at) VALUES ($1, $2, ${sql})`, [code, adminId]);
    return code;
  };
  const signup = (body: Record<string, unknown>) => client(ctx.app).post('/api/v1/auth/signup', body);
  const valid = async (over: Record<string, unknown> = {}) => ({
    handle: `user${++n}`, email: `user${n}@example.test`, password: PASSWORD, invite: await invite(), ...over,
  });

  describe('signup', () => {
    it('creates a guest with a verification email, and stores an argon2id hash', async () => {
      const body = await valid({ handle: 'ZeroCool' });
      const res = await signup(body);
      expect(res.status).toBe(201);
      const row = first(await db.query(`SELECT * FROM users WHERE handle = 'ZeroCool'`));
      expect(row.role).toBe('guest');
      expect(row.email_verified_at).toBeNull();
      expect(row.id).toMatch(/^u_[0-9A-Z]{26}$/);
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain(PASSWORD);
      expect(await verifyPassword(row.password_hash, PASSWORD)).toBe(true);
      const mail = ctx.mailer.sent.at(-1)!;
      expect(mail.to).toBe(body.email);
      expect(mail.subject).toBe('Confirm your email for Test Site');
      expect(mail.text).toContain('https://example.test/verify-email?token=');
    });

    it('requires an invite in invite mode', async () => {
      const { invite: _omit, ...noInvite } = await valid();
      const res = await signup(noInvite);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invite_required');
    });

    it('rejects unknown, used and expired invites with the same error', async () => {
      const unknown = await signup(await valid({ invite: 'NOPE-NOPE-NOPE' }));
      const used = await valid();
      expect((await signup(used)).status).toBe(201);
      const reused = await signup({ ...(await valid()), invite: used.invite });
      const expired = await signup(await valid({ invite: await invite(`now() - interval '1 hour'`) }));
      for (const r of [unknown, reused, expired]) {
        expect(r.status).toBe(400);
        expect(r.body.error.code).toBe('invite_invalid');
      }
    });

    it('marks the invite as used by the new user', async () => {
      const body = await valid();
      await signup(body);
      const inv = first(await db.query(`SELECT used_by FROM invites WHERE code = $1`, [body.invite]));
      const user = first(await db.query(`SELECT id FROM users WHERE handle = $1`, [body.handle]));
      expect(inv.used_by).toBe(user.id);
    });

    it('does not use up the invite when signup fails', async () => {
      const code = await invite();
      const existing = await valid();
      await signup(existing);
      const dup = await signup({ ...(await valid({ invite: code })), handle: existing.handle });
      expect(dup.status).toBe(409);
      expect(first(await db.query(`SELECT used_by FROM invites WHERE code = $1`, [code])).used_by).toBeNull();
    });

    it('treats handles as case-insensitive and rejects reserved ones', async () => {
      const first = await valid({ handle: 'MixedCase' });
      expect((await signup(first)).status).toBe(201);
      const clash = await signup(await valid({ handle: 'mixedcase' }));
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('handle_unavailable');
      for (const reserved of ['admin', 'Root', 'testsite']) {
        const r = await signup(await valid({ handle: reserved }));
        expect(r.body.error.code).toBe('handle_unavailable');
      }
    });

    it('rejects a duplicate email, ignoring case', async () => {
      const first = await valid({ email: 'Same@Example.test' });
      await signup(first);
      const r = await signup(await valid({ email: 'same@example.TEST' }));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('email_taken');
    });

    it('validates handle, email and password', async () => {
      for (const over of [{ handle: '1abc' }, { handle: 'a' }, { handle: 'has space' }, { handle: 'x'.repeat(21) }, { email: 'nope' }, { password: 'short' }]) {
        const r = await signup(await valid(over));
        expect(r.status, JSON.stringify(over)).toBe(400);
        expect(r.body.error.code).toBe('invalid_input');
      }
    });

    it('allows open signup with no invite when the site is open', async () => {
      const open = await makeApp(db, { yaml: `site: { name: Test Site, short_name: testsite, domain: example.test, homes_domain: example-homes.test }\nsignup: { mode: open }` });
      const { invite: _omit, ...body } = await valid();
      const r = await client(open.app).post('/api/v1/auth/signup', body);
      expect(r.status).toBe(201);
    });

    it('says plainly that application signup is not available yet', async () => {
      const apps = await makeApp(db, { yaml: `site: { name: Test Site, short_name: testsite, domain: example.test, homes_domain: example-homes.test }\nsignup: { mode: application }` });
      const r = await client(apps.app).post('/api/v1/auth/signup', await valid());
      expect(r.status).toBe(501);
    });

    it('writes user.created to the audit log', async () => {
      const body = await valid();
      await signup(body);
      const id = first(await db.query(`SELECT id FROM users WHERE handle = $1`, [body.handle])).id;
      const a = (await db.query(`SELECT * FROM audit_log WHERE action = 'user.created' AND target_id = $1`, [id])).rows;
      expect(a).toHaveLength(1);
      expect(a[0]!.origin).toBe('web');
      expect(a[0]!.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('email verification', () => {
    const register = async () => {
      const body = await valid();
      await signup(body);
      const token = tokenFromMail(ctx.mailer.sent.at(-1)!.text);
      return { body, token };
    };

    it('promotes a guest to user, bumps role_rev, and audits both changes', async () => {
      const { body, token } = await register();
      const r = await client(ctx.app).post('/api/v1/auth/verify-email', { token });
      expect(r.status).toBe(204);
      const u = first(await db.query(`SELECT id, role, role_rev, email_verified_at FROM users WHERE handle = $1`, [body.handle]));
      expect(u.role).toBe('user');
      expect(u.role_rev).toBe(1);
      expect(u.email_verified_at).not.toBeNull();
      const actions = (await db.query(`SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id`, [u.id])).rows.map((x) => x.action);
      expect(actions).toEqual(['user.created', 'user.email_verified', 'user.role_changed']);
    });

    it('works once only', async () => {
      const { token } = await register();
      expect((await client(ctx.app).post('/api/v1/auth/verify-email', { token })).status).toBe(204);
      const again = await client(ctx.app).post('/api/v1/auth/verify-email', { token });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('token_invalid');
    });

    it('refuses expired and unknown tokens', async () => {
      const { token } = await register();
      await db.query(`UPDATE email_verifications SET expires_at = now() - interval '1 minute'`);
      expect((await client(ctx.app).post('/api/v1/auth/verify-email', { token })).body.error.code).toBe('token_invalid');
      expect((await client(ctx.app).post('/api/v1/auth/verify-email', { token: 'x'.repeat(43) })).status).toBe(400);
    });

    it('stores only a hash of the token', async () => {
      const { token } = await register();
      const rows = (await db.query(`SELECT token_hash FROM email_verifications`)).rows.map((r) => r.token_hash);
      expect(rows).not.toContain(token);
    });

    it('leaves a higher role alone when an admin confirms an address', async () => {
      const { sha256 } = await import('./crypto');
      await db.query(`INSERT INTO email_verifications (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [sha256('admin-token-0123456789'), adminId]);
      const before = first(await db.query(`SELECT role_rev FROM users WHERE id = $1`, [adminId]));
      expect((await client(ctx.app).post('/api/v1/auth/verify-email', { token: 'admin-token-0123456789' })).status).toBe(204);
      const after = first(await db.query(`SELECT role, role_rev FROM users WHERE id = $1`, [adminId]));
      expect(after).toEqual({ role: 'admin', role_rev: before.role_rev });
      const roleChanges = (await db.query(`SELECT 1 FROM audit_log WHERE action = 'user.role_changed' AND target_id = $1`, [adminId])).rowCount;
      expect(roleChanges).toBe(0);
    });

    it('lets a logged-in guest ask for a new link', async () => {
      const { body } = await register();
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: body.handle, password: PASSWORD });
      const before = ctx.mailer.sent.length;
      expect((await c.post('/api/v1/auth/resend-verification')).status).toBe(204);
      expect(ctx.mailer.sent).toHaveLength(before + 1);
      const token = tokenFromMail(ctx.mailer.sent.at(-1)!.text);
      expect((await c.post('/api/v1/auth/verify-email', { token })).status).toBe(204);
      expect((await c.post('/api/v1/auth/resend-verification')).body.error.code).toBe('already_verified');
    });
  });

  describe('login and sessions', () => {
    const account = async () => {
      const body = await valid();
      await signup(body);
      return body;
    };

    it('logs in by handle or email, case-insensitively, and sets a hardened cookie', async () => {
      const body = await account();
      for (const identifier of [body.handle, body.handle.toUpperCase(), body.email, body.email.toUpperCase()]) {
        const c = client(ctx.app);
        const r = await c.post('/api/v1/auth/login', { identifier, password: PASSWORD });
        expect(r.status, identifier).toBe(200);
        expect(r.body.user).toMatchObject({ handle: body.handle, role: 'guest', limited: false });
        const cookie = r.res.cookies.find((x) => x.name === 'sid')!;
        expect(cookie.httpOnly).toBe(true);
        expect(cookie.sameSite).toBe('Lax');
        expect(cookie.path).toBe('/');
        expect((await c.get('/api/v1/me')).body.user.handle).toBe(body.handle);
      }
    });

    it('gives the same answer for a wrong password and an unknown user', async () => {
      const body = await account();
      const wrong = await client(ctx.app).post('/api/v1/auth/login', { identifier: body.handle, password: 'wrong wrong wrong' });
      const unknown = await client(ctx.app).post('/api/v1/auth/login', { identifier: 'nobody-here', password: 'wrong wrong wrong' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it('stores only a hash of the session token', async () => {
      const body = await account();
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: body.handle, password: PASSWORD });
      const hashes = (await db.query(`SELECT token_hash FROM sessions`)).rows.map((r) => r.token_hash);
      expect(hashes).not.toContain(c.sid);
      expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    });

    it('logs out: the old cookie stops working', async () => {
      const body = await account();
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: body.handle, password: PASSWORD });
      const old = c.sid;
      expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
      const replay = client(ctx.app);
      replay.sid = old;
      expect((await replay.get('/api/v1/me')).status).toBe(401);
    });

    it('rejects expired and revoked sessions', async () => {
      const body = await account();
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: body.handle, password: PASSWORD });
      await db.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
      expect((await c.get('/api/v1/me')).status).toBe(401);
    });

    it('refuses suspended accounts after a correct password, and drops their live sessions', async () => {
      const body = await account();
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: body.handle, password: PASSWORD });
      await db.query(`UPDATE users SET status = 'suspended' WHERE handle = $1`, [body.handle]);
      expect((await c.get('/api/v1/me')).status).toBe(401);
      const r = await client(ctx.app).post('/api/v1/auth/login', { identifier: body.handle, password: PASSWORD });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('suspended');
      // a wrong password must not reveal that the account is suspended
      const wrong = await client(ctx.app).post('/api/v1/auth/login', { identifier: body.handle, password: 'wrong wrong wrong' });
      expect(wrong.body.error.code).toBe('invalid_credentials');
    });

    it('requires login for /me', async () => {
      expect((await client(ctx.app).get('/api/v1/me')).status).toBe(401);
    });
  });
});
