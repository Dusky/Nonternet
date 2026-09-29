import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, resetTotp } from './accounts';
import { newId, sha256 } from './crypto';
import { hashPassword } from './passwords';
import { currentTotp } from './totp';
import { client, createTestDb, dbAvailable, first, makeApp, tokenFromMail, waitForMail } from './test/harness';

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'a different long password';

describe.skipIf(!dbAvailable)('TOTP replay, recovery codes and password reset', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let n = 0;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
  });
  afterAll(async () => drop());

  // A code for a new 30 s step each call.
  const nextCode = (secret: string) => { ctx.clock.advance(); return currentTotp(secret, ctx.clock.ms); };
  const login = (body: Record<string, unknown>) => client(ctx.app).post('/api/v1/auth/login', body);

  // An admin with TOTP fully set up. Returns what a test needs to act as them.
  async function adminWithTotp() {
    const handle = `admin${++n}`;
    await createAdmin(ctx.deps, { handle, email: `${handle}@example.test`, password: PASSWORD });
    const c = client(ctx.app);
    await c.post('/api/v1/auth/login', { identifier: handle, password: PASSWORD });
    const { body: setup } = await c.post('/api/v1/me/totp/setup');
    const enabled = await c.post('/api/v1/me/totp/enable', { code: await nextCode(setup.secret) });
    return { handle, secret: setup.secret as string, codes: enabled.body.recovery_codes as string[], c };
  }

  describe('TOTP replay protection', () => {
    it('refuses a code that was already used, and accepts the next one', async () => {
      const a = await adminWithTotp();
      const code = await nextCode(a.secret);
      expect((await login({ identifier: a.handle, password: PASSWORD, totp: code })).status).toBe(200);
      const again = await login({ identifier: a.handle, password: PASSWORD, totp: code });
      expect(again.status).toBe(401);
      expect(again.body.error.code).toBe('totp_reused');
      expect((await login({ identifier: a.handle, password: PASSWORD, totp: await nextCode(a.secret) })).status).toBe(200);
    });

    it('refuses an older code once a newer one has been used', async () => {
      const a = await adminWithTotp();
      const older = await currentTotp(a.secret, ctx.clock.ms + 30_000 * 1); // step after the enable step
      const newer = await currentTotp(a.secret, ctx.clock.ms + 30_000 * 2);
      ctx.clock.advance(60); // now the newer step is "current", the older one is one step back
      expect((await login({ identifier: a.handle, password: PASSWORD, totp: newer })).status).toBe(200);
      expect((await login({ identifier: a.handle, password: PASSWORD, totp: older })).body.error.code).toBe('totp_reused');
    });

    it('does not let the code that switched TOTP on be used straight away to log in', async () => {
      const handle = `admin${++n}`;
      await createAdmin(ctx.deps, { handle, email: `${handle}@example.test`, password: PASSWORD });
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: handle, password: PASSWORD });
      const { body: setup } = await c.post('/api/v1/me/totp/setup');
      const code = await nextCode(setup.secret);
      expect((await c.post('/api/v1/me/totp/enable', { code })).status).toBe(200);
      expect((await login({ identifier: handle, password: PASSWORD, totp: code })).body.error.code).toBe('totp_reused');
    });

    it('lets only one of two simultaneous logins use the same code', async () => {
      const a = await adminWithTotp();
      const code = await nextCode(a.secret);
      const results = await Promise.all([1, 2, 3].map(() => login({ identifier: a.handle, password: PASSWORD, totp: code })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 401, 401]);
    });

    it('still rejects a wrong code as invalid, not reused', async () => {
      const a = await adminWithTotp();
      expect((await login({ identifier: a.handle, password: PASSWORD, totp: '000000' })).body.error.code).toBe('invalid_totp');
    });
  });

  describe('recovery codes', () => {
    it('shows 10 codes once, stores only hashes, and counts them on /me', async () => {
      const a = await adminWithTotp();
      expect(a.codes).toHaveLength(10);
      expect(new Set(a.codes).size).toBe(10);
      for (const code of a.codes) expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
      const user = first(await db.query(`SELECT id FROM users WHERE handle = $1`, [a.handle]));
      const stored = (await db.query(`SELECT code_hash FROM recovery_codes WHERE user_id = $1`, [user.id])).rows.map((r) => r.code_hash);
      expect(stored).toHaveLength(10);
      for (const code of a.codes) expect(stored).not.toContain(code);
      expect(stored).toContain(sha256(a.codes[0]!));
      expect((await a.c.get('/api/v1/me')).body.user.recovery_codes_remaining).toBe(10);
    });

    it('logs in with a recovery code instead of a TOTP code, once only', async () => {
      const a = await adminWithTotp();
      const code = a.codes[0]!;
      const ok = await login({ identifier: a.handle, password: PASSWORD, recovery_code: code.toUpperCase() });
      expect(ok.status).toBe(200);
      expect(ok.body.user).toMatchObject({ limited: false, recovery_codes_remaining: 9 });
      const again = await login({ identifier: a.handle, password: PASSWORD, recovery_code: code });
      expect(again.status).toBe(401);
      expect(again.body.error.code).toBe('invalid_recovery_code');
      const user = first(await db.query(`SELECT id FROM users WHERE handle = $1`, [a.handle]));
      expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'user.recovery_code_used' AND target_id = $1`, [user.id])).rowCount).toBe(1);
    });

    it('needs the password too, and a code from another account does not work', async () => {
      const a = await adminWithTotp();
      const b = await adminWithTotp();
      expect((await login({ identifier: a.handle, password: 'wrong wrong wrong', recovery_code: a.codes[0] })).body.error.code).toBe('invalid_credentials');
      expect((await login({ identifier: a.handle, password: PASSWORD, recovery_code: b.codes[0] })).body.error.code).toBe('invalid_recovery_code');
    });

    it('regenerates a fresh set with a current code, and the old set stops working', async () => {
      const a = await adminWithTotp();
      const wrong = await a.c.post('/api/v1/me/totp/recovery-codes', { code: '000000' });
      expect(wrong.status).toBe(400);
      const fresh = await a.c.post('/api/v1/me/totp/recovery-codes', { code: await nextCode(a.secret) });
      expect(fresh.status).toBe(200);
      expect(fresh.body.recovery_codes).toHaveLength(10);
      expect(fresh.body.recovery_codes).not.toContain(a.codes[0]);
      expect((await login({ identifier: a.handle, password: PASSWORD, recovery_code: a.codes[0] })).status).toBe(401);
      expect((await login({ identifier: a.handle, password: PASSWORD, recovery_code: fresh.body.recovery_codes[0] })).status).toBe(200);
    });

    it('cannot be regenerated from a session that has no TOTP set up', async () => {
      const handle = `admin${++n}`;
      await createAdmin(ctx.deps, { handle, email: `${handle}@example.test`, password: PASSWORD });
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: handle, password: PASSWORD });
      expect((await c.post('/api/v1/me/totp/recovery-codes', { code: '123456' })).body.error.code).toBe('totp_setup_required');
    });

    it('are removed by reset-totp', async () => {
      const a = await adminWithTotp();
      await resetTotp(ctx.deps, a.handle);
      const user = first(await db.query(`SELECT id FROM users WHERE handle = $1`, [a.handle]));
      expect((await db.query(`SELECT 1 FROM recovery_codes WHERE user_id = $1`, [user.id])).rowCount).toBe(0);
      expect((await login({ identifier: a.handle, password: PASSWORD, recovery_code: a.codes[0] })).body.user.totp_enabled).toBe(false);
    });
  });

  describe('password reset', () => {
    const account = async () => {
      const handle = `user${++n}`;
      const email = `${handle}@example.test`;
      await db.query(`INSERT INTO users (id, handle, email, email_verified_at, password_hash, role) VALUES ($1, $2, $3, now(), $4, 'user')`,
        [newId('u'), handle, email, await hashPassword(PASSWORD)]);
      return { handle, email };
    };
    const forgot = (email: string) => client(ctx.app).post('/api/v1/auth/forgot-password', { email });
    const reset = (token: string, password = NEW_PASSWORD) => client(ctx.app).post('/api/v1/auth/reset-password', { token, password });
    const requestLink = async (email: string) => {
      const before = ctx.mailer.sent.length;
      await forgot(email);
      await waitForMail(ctx.mailer, before + 1);
      return tokenFromMail(ctx.mailer.sent.at(-1)!.text);
    };

    it('answers the same for a known and an unknown email, and only mails the known one', async () => {
      const u = await account();
      const before = ctx.mailer.sent.length;
      const known = await forgot(u.email.toUpperCase());
      const unknown = await forgot('nobody@example.test');
      expect(known.status).toBe(204);
      expect(unknown.status).toBe(204);
      expect(known.body).toEqual(unknown.body);
      await waitForMail(ctx.mailer, before + 1);
      await new Promise((r) => setTimeout(r, 50));
      expect(ctx.mailer.sent).toHaveLength(before + 1);
      const mail = ctx.mailer.sent.at(-1)!;
      expect(mail.to).toBe(u.email);
      expect(mail.subject).toBe('Reset your Test Site password');
      expect(mail.text).toContain('https://example.test/reset-password?token=');
    });

    it('sets the new password, ends every session, and the link works once', async () => {
      const u = await account();
      const c = client(ctx.app);
      await c.post('/api/v1/auth/login', { identifier: u.handle, password: PASSWORD });
      const token = await requestLink(u.email);
      const before = ctx.mailer.sent.length;
      expect((await reset(token)).status).toBe(204);

      expect((await c.get('/api/v1/me')).status).toBe(401);
      expect((await login({ identifier: u.handle, password: PASSWORD })).status).toBe(401);
      expect((await login({ identifier: u.handle, password: NEW_PASSWORD })).status).toBe(200);
      const again = await reset(token, 'yet another long password');
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('token_invalid');

      await waitForMail(ctx.mailer, before + 1);
      expect(ctx.mailer.sent.at(-1)!.subject).toBe('Your Test Site password was changed');
    });

    it('only the newest link works, and only a hash of it is stored', async () => {
      const u = await account();
      const first_ = await requestLink(u.email);
      const second = await requestLink(u.email);
      expect((await reset(first_)).body.error.code).toBe('token_invalid');
      const hashes = (await db.query(`SELECT token_hash FROM password_resets`)).rows.map((r) => r.token_hash);
      expect(hashes).not.toContain(second);
      expect((await reset(second)).status).toBe(204);
    });

    it('refuses an expired link', async () => {
      const u = await account();
      const token = await requestLink(u.email);
      await db.query(`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [sha256(token)]);
      expect((await reset(token)).body.error.code).toBe('token_invalid');
    });

    it('does not use up the link when the new password is too weak', async () => {
      const u = await account();
      const token = await requestLink(u.email);
      expect((await reset(token, 'short')).status).toBe(400);
      expect((await reset(token)).status).toBe(204);
    });

    it('leaves two-factor on: a reset password alone does not get an admin in', async () => {
      const a = await adminWithTotp();
      const token = await requestLink(`${a.handle}@example.test`);
      expect((await reset(token)).status).toBe(204);
      const noCode = await login({ identifier: a.handle, password: NEW_PASSWORD });
      expect(noCode.status).toBe(401);
      expect(noCode.body.error.code).toBe('totp_required');
    });

    it('lets a suspended user reset but not log in, and sends nothing for a deleted account', async () => {
      const s = await account();
      await db.query(`UPDATE users SET status = 'suspended' WHERE handle = $1`, [s.handle]);
      expect((await reset(await requestLink(s.email))).status).toBe(204);
      expect((await login({ identifier: s.handle, password: NEW_PASSWORD })).body.error.code).toBe('suspended');

      const d = await account();
      await db.query(`UPDATE users SET status = 'deleted' WHERE handle = $1`, [d.handle]);
      const before = ctx.mailer.sent.length;
      expect((await forgot(d.email)).status).toBe(204);
      await new Promise((r) => setTimeout(r, 100));
      expect(ctx.mailer.sent).toHaveLength(before);
    });

    it('audits the request and the reset', async () => {
      const u = await account();
      await reset(await requestLink(u.email));
      const id = first(await db.query(`SELECT id FROM users WHERE handle = $1`, [u.handle])).id;
      const actions = (await db.query(`SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id`, [id])).rows.map((r) => r.action);
      expect(actions).toEqual(['user.password_reset_requested', 'user.password_reset']);
    });

    it('rate limits requests per address and email', async () => {
      const limited = await makeApp(db, { rateLimit: true });
      const u = await account();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await client(limited.app).post('/api/v1/auth/forgot-password', { email: u.email })).status);
      expect(statuses).toEqual([204, 204, 204, 429]);
    });
  });
});
