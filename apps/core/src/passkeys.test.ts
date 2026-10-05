import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { processNext } from './exports/service';
import { passkeySite } from './passkey-site';
import { TestAuthenticator } from './test/authenticator';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, ORIGIN, TEST_PASSWORD } from './test/harness';

// Passkeys (docs/02): adding one needs the password; signing in with one needs no handle, password or code;
// a passkey only works for this site, once per challenge, and comes off with the account.
describe('passkey site', () => {
  it('is the hostname, and an IP address on this machine becomes localhost on the same port', () => {
    expect(passkeySite('https://example.test')).toEqual({ rpID: 'example.test', origin: 'https://example.test' });
    expect(passkeySite('http://127.0.0.1:4373')).toEqual({ rpID: 'localhost', origin: 'http://localhost:4373' });
  });
});

describe.skipIf(!dbAvailable)('passkeys', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { ({ db, drop } = await createTestDb()); ctx = await makeApp(db); });
  afterAll(async () => drop());

  const site = () => passkeySite(ORIGIN);
  async function addPasskey(c: Awaited<ReturnType<typeof loginAs>>, name = 'My phone', auth = new TestAuthenticator(ORIGIN, site().rpID)) {
    const opts = await c.post('/api/v1/me/passkeys/options', { password: TEST_PASSWORD });
    expect(opts.status).toBe(200);
    const added = await c.post('/api/v1/me/passkeys', { challenge_id: opts.body.challenge_id, name, response: auth.register(opts.body.options) });
    return { auth, added };
  }
  async function signInWith(auth: TestAuthenticator, opts: { origin?: string } = {}) {
    const c = client(ctx.app, ctx.deps.publicUrl);
    const o = await c.post('/api/v1/auth/passkey/options');
    const r = await c.post('/api/v1/auth/passkey', { challenge_id: o.body.challenge_id, response: auth.authenticate(o.body.options, opts) });
    return { c, r, challengeId: o.body.challenge_id as string, options: o.body.options };
  }

  it('adds a passkey after the password, lists it, audits it, emails about it, and signs in with it alone', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    expect((await c.post('/api/v1/me/passkeys/options', { password: 'not it' })).body.error.code).toBe('wrong_password');

    const mails = ctx.mailer.sent.length;
    const { auth, added } = await addPasskey(c);
    expect(added.status).toBe(201);
    expect(added.body.passkey).toMatchObject({ name: 'My phone', last_used_at: null });
    const list = (await c.get('/api/v1/me/passkeys')).body.passkeys;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('public_key');
    const audited = (await db.query(`SELECT action, after FROM audit_log WHERE target_id = $1 AND action LIKE 'user.passkey%'`, [u.id])).rows;
    expect(audited).toEqual([{ action: 'user.passkey_added', after: { passkey: list[0].id, name: 'My phone' } }]);
    expect(ctx.mailer.sent.length).toBe(mails + 1);

    // The options are anonymous: they name no account and list no passkeys.
    const { c: fresh, r, options } = await signInWith(auth);
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(r.status).toBe(200);
    expect(r.body.user.handle).toBe(u.handle);
    expect((await fresh.get('/api/v1/me')).body.user.id).toBe(u.id);
    expect((await c.get('/api/v1/me/passkeys')).body.passkeys[0].last_used_at).not.toBeNull();
  });

  it('skips the two-factor code: the passkey is both factors', async () => {
    const admin = await makeAdmin(ctx);
    const { auth } = await addPasskey(admin.client, 'Key');
    const { r } = await signInWith(auth);
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ handle: admin.handle, totp_enabled: true, limited: false });
  });

  it('refuses a replayed answer, a look-alike site, an unknown passkey, and one that did not check who you are', async () => {
    const u = await makeUser(ctx);
    const { auth } = await addPasskey(await loginAs(ctx, u.handle));

    // The same challenge can't be used twice.
    const c = client(ctx.app, ctx.deps.publicUrl);
    const o = await c.post('/api/v1/auth/passkey/options');
    const answer = auth.authenticate(o.body.options);
    expect((await c.post('/api/v1/auth/passkey', { challenge_id: o.body.challenge_id, response: answer })).status).toBe(200);
    expect((await c.post('/api/v1/auth/passkey', { challenge_id: o.body.challenge_id, response: answer })).body.error.code).toBe('passkey_expired');

    expect((await signInWith(auth, { origin: 'https://example.test.evil.example' })).r.body.error.code).toBe('passkey_failed');
    expect((await signInWith(new TestAuthenticator(ORIGIN, site().rpID))).r.body.error.code).toBe('passkey_unknown');

    // A key that only checked someone touched it (no PIN or fingerprint) is not enough to be added.
    const c2 = await loginAs(ctx, u.handle);
    const opts = await c2.post('/api/v1/me/passkeys/options', { password: TEST_PASSWORD });
    const weak = new TestAuthenticator(ORIGIN, site().rpID, false);
    expect((await c2.post('/api/v1/me/passkeys', { challenge_id: opts.body.challenge_id, name: 'Weak', response: weak.register(opts.body.options) })).body.error.code).toBe('passkey_failed');
  });

  it('a challenge for one person cannot add a passkey to another', async () => {
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    const ca = await loginAs(ctx, a.handle);
    const cb = await loginAs(ctx, b.handle);
    const opts = await ca.post('/api/v1/me/passkeys/options', { password: TEST_PASSWORD });
    const auth = new TestAuthenticator(ORIGIN, site().rpID);
    const r = await cb.post('/api/v1/me/passkeys', { challenge_id: opts.body.challenge_id, name: 'Stolen', response: auth.register(opts.body.options) });
    expect(r.body.error.code).toBe('passkey_expired');
  });

  it('renames and removes, audited; a removed or suspended person\'s passkey no longer signs in', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const { auth, added } = await addPasskey(c);
    const id = added.body.passkey.id as string;
    expect((await c.patch(`/api/v1/me/passkeys/${id}`, { name: 'Old phone' })).status).toBe(204);
    expect((await c.get('/api/v1/me/passkeys')).body.passkeys[0].name).toBe('Old phone');

    const other = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await other.delete(`/api/v1/me/passkeys/${id}`)).status).toBe(404);

    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
    expect((await signInWith(auth)).r.body.error.code).toBe('suspended');
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [u.id]);

    expect((await c.delete(`/api/v1/me/passkeys/${id}`)).status).toBe(204);
    expect((await signInWith(auth)).r.body.error.code).toBe('passkey_unknown');
    const actions = (await db.query(`SELECT action, before FROM audit_log WHERE target_id = $1 AND action = 'user.passkey_removed'`, [u.id])).rows;
    expect(actions).toEqual([{ action: 'user.passkey_removed', before: { passkey: id, name: 'Old phone' } }]);
  });

  it('is in the export as a record without keys, and goes with the account', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await addPasskey(c, 'Laptop');
    expect((await c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [u.id])).rows[0]!;
    const files = unzipSync(new Uint8Array(readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`))));
    const listed = JSON.parse(strFromU8(files['keys/passkeys.json']!));
    expect(listed).toEqual([expect.objectContaining({ name: 'Laptop', last_used_at: null, transports: ['internal'] })]);
    expect(Object.keys(listed[0]).sort()).toEqual(['created_at', 'id', 'last_used_at', 'name', 'synced', 'transports']);

    expect((await c.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: u.handle, posts: 'keep' })).status).toBe(204);
    expect((await db.query(`SELECT 1 FROM webauthn_credentials WHERE user_id = $1`, [u.id])).rowCount).toBe(0);
  });
});
