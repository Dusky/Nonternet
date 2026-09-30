import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin, resetTotp } from './accounts';
import { decryptSecret } from './crypto';
import { currentTotp } from './totp';
import { client, createTestDb, dbAvailable, makeApp, first } from './test/harness';

const PASSWORD = 'correct horse battery';

describe.skipIf(!dbAvailable)('admin, TOTP and invites', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    await createAdmin(ctx.deps, { handle: 'boss', email: 'boss@example.test', password: PASSWORD });
  });
  afterAll(async () => drop());

  // A code for a new 30 s step each time, so a test never trips the replay check by accident.
  const freshCode = (secret: string) => { ctx.clock.advance(); return currentTotp(secret, ctx.clock.ms); };

  const loginAdmin = async (totp?: string) => {
    const c = client(ctx.app);
    const r = await c.post('/api/v1/auth/login', { identifier: 'boss', password: PASSWORD, ...(totp ? { totp } : {}) });
    return { c, r };
  };

  it('the create-admin operator command makes a verified admin and audits it as cli', async () => {
    const u = first(await db.query(`SELECT id, role, email_verified_at FROM users WHERE handle = 'boss'`));
    expect(u.role).toBe('admin');
    expect(u.email_verified_at).not.toBeNull();
    const a = first(await db.query(`SELECT actor_kind, origin FROM audit_log WHERE target_id = $1`, [u.id]));
    expect(a).toEqual({ actor_kind: 'cli', origin: 'cli' });
  });

  it('gives an admin without TOTP a limited session that cannot use admin calls', async () => {
    const { c, r } = await loginAdmin();
    expect(r.body.user).toMatchObject({ role: 'admin', limited: true, totp_enabled: false });
    expect((await c.get('/api/v1/me')).status).toBe(200);
    const inv = await c.post('/api/v1/admin/invites', {});
    expect(inv.status).toBe(403);
    expect(inv.body.error.code).toBe('totp_setup_required');
  });

  it('sets up TOTP, encrypts the secret at rest, and lifts the limit', async () => {
    const { c } = await loginAdmin();
    const setup = await c.post('/api/v1/me/totp/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauth_url).toMatch(/^otpauth:\/\/totp\/.*issuer=Test(%20|\+)Site/);
    const stored = first(await db.query(`SELECT totp_secret_enc FROM users WHERE handle = 'boss'`)).totp_secret_enc;
    expect(stored).not.toContain(setup.body.secret);
    expect(decryptSecret(ctx.deps.secretKey, stored)).toBe(setup.body.secret);

    const wrong = await c.post('/api/v1/me/totp/enable', { code: '000000' });
    expect(wrong.status).toBe(400);
    expect((await c.post('/api/v1/admin/invites', {})).status).toBe(403);

    const enabled = await c.post('/api/v1/me/totp/enable', { code: await freshCode(setup.body.secret) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.recovery_codes).toHaveLength(10);
    expect((await c.get('/api/v1/me')).body.user).toMatchObject({ limited: false, totp_enabled: true });
    expect((await c.post('/api/v1/admin/invites', {})).status).toBe(201);
  });

  it('then requires a code at login', async () => {
    const secret = decryptSecret(ctx.deps.secretKey, first(await db.query(`SELECT totp_secret_enc FROM users WHERE handle = 'boss'`)).totp_secret_enc);
    const missing = await loginAdmin();
    expect(missing.r.status).toBe(401);
    expect(missing.r.body.error.code).toBe('totp_required');
    const wrong = await loginAdmin('000000');
    expect(wrong.r.body.error.code).toBe('invalid_totp');
    const ok = await loginAdmin(await freshCode(secret));
    expect(ok.r.status).toBe(200);
    expect(ok.r.body.user.limited).toBe(false);
  });

  it('does not reveal that TOTP is on when the password is wrong', async () => {
    const r = await client(ctx.app).post('/api/v1/auth/login', { identifier: 'boss', password: 'wrong wrong wrong' });
    expect(r.body.error.code).toBe('invalid_credentials');
  });

  it('creates an invite an admin can hand out, and audits it', async () => {
    const secret = decryptSecret(ctx.deps.secretKey, first(await db.query(`SELECT totp_secret_enc FROM users WHERE handle = 'boss'`)).totp_secret_enc);
    const { c } = await loginAdmin(await freshCode(secret));
    const r = await c.post('/api/v1/admin/invites', { expires_in_days: 3 });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const days = (new Date(r.body.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'invite.created' AND target_id = $1`, [r.body.code])).rowCount).toBe(1);

    // and that invite works for signup
    const signup = await client(ctx.app).post('/api/v1/auth/signup', { handle: 'newbie', email: 'newbie@example.test', password: PASSWORD, invite: r.body.code, age_confirmed: true });
    expect(signup.status).toBe(201);
  });

  it('keeps ordinary users away from admin calls', async () => {
    await db.query(`INSERT INTO invites (code, created_by, expires_at) SELECT 'PLAIN-INVITE', id, now() + interval '1 day' FROM users WHERE handle = 'boss'`);
    const c = client(ctx.app);
    await c.post('/api/v1/auth/signup', { handle: 'plain', email: 'plain@example.test', password: PASSWORD, invite: 'PLAIN-INVITE', age_confirmed: true });
    await c.post('/api/v1/auth/login', { identifier: 'plain', password: PASSWORD });
    const r = await c.post('/api/v1/admin/invites', {});
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden');
    expect((await client(ctx.app).post('/api/v1/admin/invites', {})).status).toBe(401);
  });

  it('reset-totp turns TOTP off and signs the admin out everywhere', async () => {
    const secret = decryptSecret(ctx.deps.secretKey, first(await db.query(`SELECT totp_secret_enc FROM users WHERE handle = 'boss'`)).totp_secret_enc);
    const { c } = await loginAdmin(await freshCode(secret));
    await resetTotp(ctx.deps, 'boss');
    expect((await c.get('/api/v1/me')).status).toBe(401);
    const { r } = await loginAdmin();
    expect(r.body.user).toMatchObject({ limited: true, totp_enabled: false });
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'user.totp_reset'`)).rowCount).toBe(1);
  });
});
