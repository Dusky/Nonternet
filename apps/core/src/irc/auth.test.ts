import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser, TEST_PASSWORD } from '../test/harness';
import { ergoAvailable, ircLogin, startErgo, type RunningErgo } from '../test/ergo';
import { ircSecrets } from './secrets';

const SECRET = 'irc-auth-test-secret-0123456789abcdefghij';

describe.skipIf(!dbAvailable)('IRC sign-in (terminal passwords and tickets)', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  const secrets = ircSecrets(SECRET);
  const auth = (body: object, token = secrets.authToken) => client(ctx.app).post('/internal/irc/auth', body, { authorization: `Bearer ${token}`, origin: '' });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db, { irc: { secrets, host: '127.0.0.1', port: 1, apiUrl: 'http://127.0.0.1:1' } });
  });
  afterAll(async () => drop());

  it('sets and removes a terminal password, only with the website password, and audits both', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    expect((await c.get('/api/v1/me/terminal-password')).body).toEqual({ set: false, set_at: null });
    expect((await c.put('/api/v1/me/terminal-password', { password: 'wrong wrong wrong', terminal_password: 'a terminal password' })).body.error.code).toBe('wrong_password');
    expect((await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: TEST_PASSWORD })).body.error.code).toBe('same_password');
    expect((await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'short' })).status).toBe(400);
    expect((await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'a terminal password' })).status).toBe(204);
    expect((await c.get('/api/v1/me/terminal-password')).body.set).toBe(true);
    expect((await auth({ accountName: u.handle.toUpperCase(), passphrase: 'a terminal password' })).body).toEqual({ success: true, accountName: u.handle });
    expect((await c.post('/api/v1/me/terminal-password/remove', { password: 'nope nope nope' })).status).toBe(400);
    expect((await c.post('/api/v1/me/terminal-password/remove', { password: TEST_PASSWORD })).status).toBe(204);
    expect((await auth({ accountName: u.handle, passphrase: 'a terminal password' })).body.success).toBe(false);
    const a = await db.query(`SELECT action FROM audit_log WHERE target_id = $1 AND action LIKE 'user.terminal_password%' ORDER BY id`, [u.id]);
    expect(a.rows.map((r) => r.action)).toEqual(['user.terminal_password_set', 'user.terminal_password_cleared']);
  });

  it('stops guessing: after ten wrong terminal passwords the account refuses terminal logins for a while', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'the real terminal pass' });
    for (let i = 0; i < 10; i++) expect((await auth({ accountName: u.handle, passphrase: `guess ${i}` })).body.success).toBe(false);
    const r = (await auth({ accountName: u.handle, passphrase: 'the real terminal pass' })).body;
    expect(r).toEqual({ success: false, error: 'too many attempts; try again later' });
    // Someone else's account is unaffected.
    const v = await makeUser(ctx);
    const cv = await loginAs(ctx, v.handle);
    await cv.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'another terminal pass' });
    expect((await auth({ accountName: v.handle, passphrase: 'another terminal pass' })).body.success).toBe(true);
  });

  it('refuses the auth-script call without the right token', async () => {
    expect((await auth({ accountName: 'x', passphrase: 'y' }, 'wrong')).status).toBe(401);
    expect((await client(ctx.app).post('/internal/irc/auth', { accountName: 'x', passphrase: 'y' }, { origin: '' })).status).toBe(401);
  });

  it('issues one-use tickets that expire, and only to confirmed users', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const t = (await c.post('/api/v1/irc/ticket')).body;
    expect(t).toMatchObject({ nick: u.handle, expires_in: 60 });
    expect(t.ticket).toMatch(/^tk1_/);
    expect((await auth({ accountName: 'someoneelse', passphrase: t.ticket })).body.success).toBe(false);
    expect((await auth({ accountName: u.handle, passphrase: t.ticket })).body).toEqual({ success: true, accountName: u.handle });
    expect((await auth({ accountName: u.handle, passphrase: t.ticket })).body.success).toBe(false); // used
    const late = (await c.post('/api/v1/irc/ticket')).body.ticket;
    ctx.clock.advance(61);
    expect((await auth({ accountName: u.handle, passphrase: late })).body.success).toBe(false);

    const guest = await makeUser(ctx, { role: 'guest', verified: false });
    const g = await loginAs(ctx, guest.handle);
    expect((await g.post('/api/v1/irc/ticket')).body.error.code).toBe('email_unconfirmed');
    expect((await client(ctx.app).post('/api/v1/irc/ticket')).status).toBe(401);
  });

  it('refuses suspended people and guests even with a correct password', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'a terminal password' });
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
    expect((await auth({ accountName: u.handle, passphrase: 'a terminal password' })).body.success).toBe(false);
    await db.query(`UPDATE users SET status = 'active', role = 'guest' WHERE id = $1`, [u.id]);
    expect((await auth({ accountName: u.handle, passphrase: 'a terminal password' })).body.success).toBe(false);
  });

  it('says chat is not set up when the site has no IRC', async () => {
    const off = await makeApp(db);
    const u = await makeUser(off);
    expect((await (await loginAs(off, u.handle)).post('/api/v1/irc/ticket')).body.error.code).toBe('irc_off');
  });

  describe.skipIf(!ergoAvailable)('through a real Ergo', () => {
    let ergo: RunningErgo;
    beforeAll(async () => {
      await ctx.app.listen({ port: 0, host: '127.0.0.1' });
      const port = (ctx.app.server.address() as { port: number }).port;
      ergo = await startErgo(ctx.deps.config, { coreUrl: `http://127.0.0.1:${port}`, secret: SECRET });
      Object.assign(ctx.deps.irc!, ergo.irc);
    }, 30_000);
    afterAll(async () => { await ergo?.stop(); });

    it('lets a native client in with the terminal password, as their own nick, and nobody else', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'a terminal password' });
      const ok = await ircLogin(ergo.irc, u.handle, 'a terminal password');
      expect(ok.ok, ok.ok ? '' : ok.reason).toBe(true);
      if (ok.ok) { expect(ok.client.user.nick).toBe(u.handle); ok.client.quit(); }
      const bad = await ircLogin(ergo.irc, u.handle, 'not the password');
      expect(bad.ok).toBe(false);
      // The web password is not the IRC password.
      expect((await ircLogin(ergo.irc, u.handle, TEST_PASSWORD)).ok).toBe(false);
    }, 30_000);

    it('lets the Chat app in with a ticket, once', async () => {
      const u = await makeUser(ctx);
      const c = await loginAs(ctx, u.handle);
      const { ticket } = (await c.post('/api/v1/irc/ticket')).body;
      const ok = await ircLogin(ergo.irc, u.handle, ticket);
      expect(ok.ok, ok.ok ? '' : ok.reason).toBe(true);
      if (ok.ok) ok.client.quit();
      expect((await ircLogin(ergo.irc, u.handle, ticket)).ok).toBe(false);
    }, 30_000);
  });
});
