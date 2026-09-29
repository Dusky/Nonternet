import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from './accounts';
import { newId } from './crypto';
import { client, createTestDb, dbAvailable, first, loginAs, makeApp, makeUser, TEST_PASSWORD, waitForMail } from './test/harness';

describe.skipIf(!dbAvailable)('profile and password', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => { ({ db, drop } = await createTestDb()); ctx = await makeApp(db); });
  afterAll(async () => drop());

  describe('editing your profile', () => {
    it('changes only what is sent, and trims it', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      const r = await (async () => { const res = await ctx.app.inject({ method: 'PATCH', url: '/api/v1/me', payload: { display_name: '  Dade  ' }, headers: { origin: ctx.deps.publicUrl, cookie: `sid=${c.sid}` } }); return { status: res.statusCode, body: res.json() }; })();
      expect(r.status).toBe(200);
      expect(r.body.user).toMatchObject({ display_name: 'Dade', bio: null, theme: null });
      const again = await ctx.app.inject({ method: 'PATCH', url: '/api/v1/me', payload: { bio: 'I like modems.', theme: 'amber' }, headers: { origin: ctx.deps.publicUrl, cookie: `sid=${c.sid}` } });
      expect(again.json().user).toMatchObject({ display_name: 'Dade', bio: 'I like modems.', theme: 'amber' });
    });

    it('clears a display name or bio with an empty value or null, and keeps the theme choice for next login', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      const patch = (payload: object) => ctx.app.inject({ method: 'PATCH', url: '/api/v1/me', payload, headers: { origin: ctx.deps.publicUrl, cookie: `sid=${c.sid}` } });
      await patch({ display_name: 'Name', bio: 'Bio', theme: 'amber' });
      const cleared = (await patch({ display_name: '', bio: null })).json().user;
      expect(cleared).toMatchObject({ display_name: null, bio: null, theme: 'amber' });
      const relog = await loginAs(ctx, u.handle);
      expect((await relog.get('/api/v1/me')).body.user.theme).toBe('amber');
      expect((await patch({ theme: null })).json().user.theme).toBeNull();
    });

    it('rejects an unknown theme, an over-long value, an empty change and anonymous callers', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      const patch = (payload: object, cookie = `sid=${c.sid}`) => ctx.app.inject({ method: 'PATCH', url: '/api/v1/me', payload, headers: { origin: ctx.deps.publicUrl, cookie } });
      expect((await patch({ theme: 'neon' })).statusCode).toBe(400);
      expect((await patch({ display_name: 'x'.repeat(61) })).statusCode).toBe(400);
      expect((await patch({ bio: 'x'.repeat(501) })).statusCode).toBe(400);
      expect((await patch({})).statusCode).toBe(400);
      expect((await patch({ display_name: 'Nope' }, 'sid=invalid')).statusCode).toBe(401);
    });

    it('cannot be used to change anything but the profile fields', async () => {
      const u = await makeUser(ctx, { role: 'user' });
      const c = await loginAs(ctx, u.handle);
      const res = await ctx.app.inject({ method: 'PATCH', url: '/api/v1/me', payload: { display_name: 'X', role: 'admin', handle: 'hijack', email: 'evil@example.test' }, headers: { origin: ctx.deps.publicUrl, cookie: `sid=${c.sid}` } });
      expect(res.statusCode).toBe(200);
      const row = first(await db.query(`SELECT role, handle, email FROM users WHERE id = $1`, [u.id]));
      expect(row).toEqual({ role: 'user', handle: u.handle, email: u.email });
    });
  });

  describe('changing your password', () => {
    const change = (c: ReturnType<typeof client>, body: object) => ctx.app.inject({ method: 'PUT', url: '/api/v1/me/password', payload: body, headers: { origin: ctx.deps.publicUrl, cookie: `sid=${c.sid}` } });
    const NEW = 'another long password here';

    it('sets it, keeps this session, and signs out every other session', async () => {
      const u = await makeUser(ctx);
      const here = await loginAs(ctx, u.handle);
      const elsewhere = await loginAs(ctx, u.handle);
      expect((await change(here, { current_password: TEST_PASSWORD, new_password: NEW })).statusCode).toBe(204);
      expect((await here.get('/api/v1/me')).status).toBe(200);
      expect((await elsewhere.get('/api/v1/me')).status).toBe(401);
      expect((await client(ctx.app, ctx.deps.publicUrl).post('/api/v1/auth/login', { identifier: u.handle, password: TEST_PASSWORD })).status).toBe(401);
      expect((await client(ctx.app, ctx.deps.publicUrl).post('/api/v1/auth/login', { identifier: u.handle, password: NEW })).status).toBe(200);
    });

    it('ends the grants services hold, audits it, announces it and sends a notice', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      await db.query(`INSERT INTO oidc_payloads (id, type, payload, account_id, expires_at) VALUES ($1, 'RefreshToken', '{}', $2, now() + interval '1 hour')`, [newId('e'), u.id]);
      const mails = ctx.mailer.sent.length;
      expect((await change(c, { current_password: TEST_PASSWORD, new_password: NEW })).statusCode).toBe(204);
      expect((await db.query(`SELECT 1 FROM oidc_payloads WHERE account_id = $1`, [u.id])).rowCount).toBe(0);
      expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'user.password_changed' AND target_id = $1`, [u.id])).rowCount).toBe(1);
      expect((await db.query(`SELECT payload FROM events_outbox WHERE type = 'session.revoked' AND payload->>'user_id' = $1`, [u.id])).rows.map((r) => r.payload.reason)).toContain('password_changed');
      await waitForMail(ctx.mailer, mails + 1);
      expect(ctx.mailer.sent.at(-1)!.subject).toBe('Your Test Site password was changed');
    });

    it('needs the right current password, and a different, long enough new one', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      const wrong = await change(c, { current_password: 'not my password', new_password: NEW });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error.code).toBe('wrong_password');
      expect((await change(c, { current_password: TEST_PASSWORD, new_password: TEST_PASSWORD })).json().error.code).toBe('same_password');
      expect((await change(c, { current_password: TEST_PASSWORD, new_password: 'short' })).statusCode).toBe(400);
      expect((await client(ctx.app, ctx.deps.publicUrl).post('/api/v1/auth/login', { identifier: u.handle, password: TEST_PASSWORD })).status).toBe(200); // unchanged
    });

    it('is refused for anonymous callers and for a session still limited to two-factor setup', async () => {
      expect((await ctx.app.inject({ method: 'PUT', url: '/api/v1/me/password', payload: { current_password: 'a', new_password: NEW }, headers: { origin: ctx.deps.publicUrl } })).statusCode).toBe(401);
      const handle = `newadmin${Math.random().toString(36).slice(2, 6)}`;
      await createAdmin(ctx.deps, { handle, email: `${handle}@example.test`, password: TEST_PASSWORD });
      const limited = await loginAs(ctx, handle);
      expect((await change(limited, { current_password: TEST_PASSWORD, new_password: NEW })).json().error.code).toBe('totp_setup_required');
    });
  });
});
