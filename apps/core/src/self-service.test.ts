import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD, tokenFromMail, waitForMail } from './test/harness';
import { currentTotp } from './totp';
import { EXPORTERS, type ExportUser } from './exports/exporters';

// What people can now do for themselves (docs/02): change their email or handle, and turn two-factor off.
describe.skipIf(!dbAvailable)('self-service', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
  });
  afterAll(async () => drop());

  describe('changing your email', () => {
    it('keeps the old address until the new one is confirmed, tells the old one, and the link works once', async () => {
      const u = await makeUser(ctx, { handle: 'emma' });
      const c = await loginAs(ctx, 'emma');
      const sent = ctx.mailer.sent.length;
      expect((await c.post('/api/v1/me/email', { password: 'wrong password!', email: 'new@example.test' })).body.error.code).toBe('wrong_password');
      expect((await c.post('/api/v1/me/email', { password: TEST_PASSWORD, email: 'new@example.test' })).status).toBe(202);
      await waitForMail(ctx.mailer, sent + 2);
      const mails = ctx.mailer.sent.slice(sent);
      const toNew = mails.find((m) => m.to === 'new@example.test')!;
      const toOld = mails.find((m) => m.to === u.email)!;
      expect(toNew.text).toContain('https://example.test/confirm-email?token=');
      expect(toOld.text).toContain('n•••@example.test');
      expect(toOld.text).not.toContain('new@example.test');
      expect((await c.get('/api/v1/me')).body.user.email).toBe(u.email);

      const token = tokenFromMail(toNew.text);
      const anon = client(ctx.app);
      expect((await anon.post('/api/v1/auth/confirm-email', { token })).status).toBe(204);
      expect((await c.get('/api/v1/me')).body.user.email).toBe('new@example.test');
      expect((await anon.post('/api/v1/auth/confirm-email', { token })).body.error.code).toBe('token_invalid');
      const a = first(await db.query(`SELECT before, after FROM audit_log WHERE action = 'user.email_changed' AND target_id = $1`, [u.id]));
      expect(a).toEqual({ before: { email: 'e•••@example.test' }, after: { email: 'n•••@example.test' } });
      expect((await anon.post('/api/v1/auth/login', { identifier: 'new@example.test', password: TEST_PASSWORD })).status).toBe(200);
    });

    it('refuses an address someone else has, and only the newest link works', async () => {
      await makeUser(ctx, { handle: 'fay' });
      await makeUser(ctx, { handle: 'gus' });
      const c = await loginAs(ctx, 'fay');
      expect((await c.post('/api/v1/me/email', { password: TEST_PASSWORD, email: 'GUS@example.test' })).body.error.code).toBe('email_taken');
      let n = ctx.mailer.sent.length;
      await c.post('/api/v1/me/email', { password: TEST_PASSWORD, email: 'fay1@example.test' });
      const first_ = tokenFromMail(ctx.mailer.sent.slice(n).find((m) => m.to === 'fay1@example.test')!.text);
      n = ctx.mailer.sent.length;
      await c.post('/api/v1/me/email', { password: TEST_PASSWORD, email: 'fay2@example.test' });
      const second = tokenFromMail(ctx.mailer.sent.slice(n).find((m) => m.to === 'fay2@example.test')!.text);
      expect((await client(ctx.app).post('/api/v1/auth/confirm-email', { token: first_ })).status).toBe(400);
      expect((await client(ctx.app).post('/api/v1/auth/confirm-email', { token: second })).status).toBe(204);
    });
  });

  describe('changing your handle', () => {
    it('needs the password, keeps the 90-day hold and redirect, and allows one change every 90 days', async () => {
      const u = await makeUser(ctx, { handle: 'hal' });
      const c = await loginAs(ctx, 'hal');
      expect((await c.get('/api/v1/me/handle')).body).toEqual({ changeable_at: null });
      expect((await c.post('/api/v1/me/handle', { password: 'nope nope nope', handle: 'hally' })).body.error.code).toBe('wrong_password');
      const r = await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'hally' });
      expect(r.status).toBe(200);
      expect(r.body.handle).toBe('hally');
      expect(first(await db.query(`SELECT actor_id FROM audit_log WHERE action = 'user.renamed' AND target_id = $1`, [u.id])).actor_id).toBe(u.id);
      expect(first(await db.query(`SELECT by_user FROM handle_history WHERE user_id = $1`, [u.id])).by_user).toBe(true);

      // Too soon for another one, but a change of letter case is fine.
      const again = await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'hallo' });
      expect(again.body.error.code).toBe('rename_too_soon');
      expect((await c.get('/api/v1/me/handle')).body.changeable_at).toMatch(/^\d{4}-/);
      expect((await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'Hally' })).status).toBe(200);

      // Nobody else can take the old one.
      await makeUser(ctx, { handle: 'ivy' });
      expect((await (await loginAs(ctx, 'ivy')).post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'hal' })).body.error.code).toBe('handle_unavailable');

      // 90 days on, they can change it again.
      await db.query(`UPDATE handle_history SET changed_at = now() - interval '91 days' WHERE user_id = $1`, [u.id]);
      expect((await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'hallo' })).status).toBe(200);
    });

    it("doesn't count an admin's rename against the person", async () => {
      const admin = await makeAdmin(ctx);
      const u = await makeUser(ctx, { handle: 'jo' });
      expect((await admin.client.post(`/api/v1/admin/users/${u.id}/rename`, { handle: 'joanne', reason: 'asked' })).status).toBe(200);
      const c = await loginAs(ctx, 'joanne');
      expect((await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'jojo' })).status).toBe(200);
    });

    it('refuses reserved handles and ones in use', async () => {
      await makeUser(ctx, { handle: 'kit' });
      await makeUser(ctx, { handle: 'lou' });
      const c = await loginAs(ctx, 'kit');
      expect((await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'sysop' })).body.error.code).toBe('handle_unavailable');
      expect((await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'LOU' })).body.error.code).toBe('handle_unavailable');
      expect((await c.post('/api/v1/me/handle', { password: TEST_PASSWORD, handle: 'kit' })).body.error.code).toBe('no_change');
    });
  });

  describe('turning two-factor off', () => {
    it('needs the password and a code, signs out other sessions, audits and tells the person', async () => {
      const admin = await makeAdmin(ctx); // an admin is the quickest person with two-factor on; the site doesn't require it
      const other = await loginAsWithCode(admin.handle, admin.secret);
      ctx.clock.advance();
      expect((await admin.client.post('/api/v1/me/totp/disable', { password: TEST_PASSWORD, totp: '000000' })).body.error.code).toBe('invalid_totp');
      expect((await admin.client.post('/api/v1/me/totp/disable', { password: 'wrong wrong wrong', totp: await currentTotp(admin.secret, ctx.clock.ms) })).body.error.code).toBe('wrong_password');
      const n = ctx.mailer.sent.length;
      ctx.clock.advance();
      expect((await admin.client.post('/api/v1/me/totp/disable', { password: TEST_PASSWORD, totp: await currentTotp(admin.secret, ctx.clock.ms) })).status).toBe(204);
      expect((await admin.client.get('/api/v1/me')).body.user).toMatchObject({ totp_enabled: false, recovery_codes_remaining: 0 });
      expect((await other.get('/api/v1/me')).status).toBe(401);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'user.totp_disabled' AND target_id = $1`, [admin.id])).n).toBe(1);
      await waitForMail(ctx.mailer, n + 1);
      expect(ctx.mailer.sent.at(-1)!.subject).toContain('Two-factor authentication is off');
      // Logging in now needs only the password.
      expect((await client(ctx.app).post('/api/v1/auth/login', { identifier: admin.handle, password: TEST_PASSWORD })).status).toBe(200);
    });

    it('is refused for an admin when the site requires admin two-factor', async () => {
      const admin = await makeAdmin(ctx);
      ctx.deps.config.security.require_admin_2fa = true;
      try {
        ctx.clock.advance();
        const r = await admin.client.post('/api/v1/me/totp/disable', { password: TEST_PASSWORD, totp: await currentTotp(admin.secret, ctx.clock.ms) });
        expect(r.body.error.code).toBe('totp_required_here');
      } finally {
        ctx.deps.config.security.require_admin_2fa = false;
      }
    });
  });

  describe('signing up by application', () => {
    let apps: Awaited<ReturnType<typeof makeApp>>;
    beforeAll(async () => { apps = await makeApp(db, { yaml: `site: { name: Test Site, short_name: testsite, domain: example.test, homes_domain: example-homes.test }\nsignup: { mode: application }` }); });
    const apply = async (handle: string) => {
      const r = await client(apps.app).post('/api/v1/auth/signup', { handle, email: `${handle}@example.test`, password: TEST_PASSWORD, age_confirmed: true, application: 'I make tracker music and want somewhere quiet to post it.' });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    const confirm = async (email: string) => {
      const mail = apps.mailer.sent.filter((m) => m.to === email && m.text.includes('/verify-email?token=')).at(-1)!;
      expect((await client(apps.app).post('/api/v1/auth/verify-email', { token: tokenFromMail(mail.text) })).status).toBe(204);
    };
    const role = async (id: string) => first(await db.query(`SELECT role, status FROM users WHERE id = $1`, [id]));

    it('stays a guest after confirming the email until an admin approves; then is a user, told, and it is in the export', async () => {
      const admin = await makeAdmin(apps);
      const id = await apply('nora');
      await confirm('nora@example.test');
      expect(await role(id)).toMatchObject({ role: 'guest', status: 'active' });
      const c = await loginAs(apps, 'nora');
      expect((await c.get('/api/v1/me/application')).body.application).toMatchObject({ state: 'pending' });

      const queue = (await admin.client.get('/api/v1/admin/applications')).body.applications;
      expect(queue).toEqual([expect.objectContaining({ user_id: id, handle: 'nora', email_verified: true, text: expect.stringContaining('tracker music') })]);
      expect((await c.get('/api/v1/admin/applications')).status).toBe(403);
      const n = apps.mailer.sent.length;
      expect((await admin.client.post(`/api/v1/admin/applications/${id}`, { decision: 'approve' })).status).toBe(204);
      expect(await role(id)).toMatchObject({ role: 'user' });
      expect((await admin.client.post(`/api/v1/admin/applications/${id}`, { decision: 'approve' })).body.error.code).toBe('no_change');
      expect((await admin.client.get('/api/v1/admin/applications')).body.applications).toEqual([]);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'application.approved' AND target_id = $1`, [id])).n).toBe(1);
      await waitForMail(apps.mailer, n + 1);
      expect(apps.mailer.sent.at(-1)!.text).toContain('you are in');

      const files: Record<string, string> = {};
      const u = first<ExportUser>(await db.query(`SELECT id, handle, display_name, bio, email, role, theme, theme_variant, created_at, NULL AS public_key FROM users WHERE id = $1`, [id]));
      await EXPORTERS.find((e) => e.id === 'profile')!.run({ deps: apps.deps, user: u, add: (p, d) => { files[p] = String(d); } });
      expect(JSON.parse(files['profile.json']!).application).toMatchObject({ state: 'approved', text: expect.stringContaining('tracker music') });
    });

    it('approving before the email is confirmed promotes on confirmation', async () => {
      const admin = await makeAdmin(apps);
      const id = await apply('otto');
      await admin.client.post(`/api/v1/admin/applications/${id}`, { decision: 'approve' });
      expect(await role(id)).toMatchObject({ role: 'guest' });
      await confirm('otto@example.test');
      expect(await role(id)).toMatchObject({ role: 'user' });
    });

    it('declining needs a reason, suspends the account and tells the person why', async () => {
      const admin = await makeAdmin(apps);
      const id = await apply('pip');
      expect((await admin.client.post(`/api/v1/admin/applications/${id}`, { decision: 'decline' })).body.error.code).toBe('reason_required');
      const n = apps.mailer.sent.length;
      expect((await admin.client.post(`/api/v1/admin/applications/${id}`, { decision: 'decline', reason: 'We are full for now.' })).status).toBe(204);
      expect(await role(id)).toMatchObject({ role: 'guest', status: 'suspended' });
      await waitForMail(apps.mailer, n + 1);
      expect(apps.mailer.sent.at(-1)!.text).toContain('We are full for now.');
    });
  });

  async function loginAsWithCode(handle: string, secret: string) {
    const c = client(ctx.app);
    ctx.clock.advance();
    const r = await c.post('/api/v1/auth/login', { identifier: handle, password: TEST_PASSWORD, totp: await currentTotp(secret, ctx.clock.ms) });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    return c;
  }
});
