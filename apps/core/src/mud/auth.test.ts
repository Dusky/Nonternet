import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser, TEST_PASSWORD } from '../test/harness';
import { newId } from '../crypto';
import { ircSecrets } from '../irc/secrets';
import { mudSecrets } from './secrets';

describe.skipIf(!dbAvailable)('MUD sign-in', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  const secrets = mudSecrets('mud-test-secret-0123456789abcdefghijklmn');
  const auth = (body: object, token = secrets.authToken) => client(ctx.app).post('/internal/mud/auth', body, { authorization: `Bearer ${token}`, origin: '' });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db, {
      mud: { secrets, url: 'http://127.0.0.1:1' },
      irc: { secrets: ircSecrets('irc-test-secret-0123456789abcdefghijklmn'), host: '127.0.0.1', port: 1, apiUrl: 'http://127.0.0.1:1' },
    });
  });
  afterAll(async () => drop());

  it('checks a ticket once and says who the person is, their role and whether they build', async () => {
    const u = await makeUser(ctx, { role: 'trusted' });
    const c = await loginAs(ctx, u.handle);
    const { ticket } = (await c.post('/api/v1/mud/ticket')).body;
    expect((await auth({ accountName: u.handle, passphrase: ticket })).body).toEqual({ success: true, accountName: u.handle, user_id: u.id, role: 'trusted', builder: false });
    expect((await auth({ accountName: u.handle, passphrase: ticket })).body.success).toBe(false);
    await db.query(`INSERT INTO scoped_roles (id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1, $2, 'mud_builder', 'mud', 'world', $2)`, [newId('o'), u.id]);
    const again = (await c.post('/api/v1/mud/ticket')).body.ticket;
    expect((await auth({ accountName: u.handle, passphrase: again })).body.builder).toBe(true);
  });

  it('keeps chat tickets and MUD tickets apart', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const chat = (await c.post('/api/v1/irc/ticket')).body.ticket;
    expect((await auth({ accountName: u.handle, passphrase: chat })).body.success).toBe(false);
    const mud = (await c.post('/api/v1/mud/ticket')).body.ticket;
    const irc = await client(ctx.app).post('/internal/irc/auth', { accountName: u.handle, passphrase: mud }, { authorization: `Bearer ${ctx.deps.irc!.secrets.authToken}`, origin: '' });
    expect(irc.body.success).toBe(false);
  });

  it('takes the terminal password, refuses guests and the wrong token, and is off without MUD_SECRET', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'my terminal words' });
    expect((await auth({ accountName: u.handle, passphrase: 'my terminal words' })).body.success).toBe(true);
    expect((await auth({ accountName: u.handle, passphrase: 'my terminal words' }, ctx.deps.irc!.secrets.authToken)).status).toBe(401);
    const guest = await makeUser(ctx, { role: 'guest', verified: false });
    expect((await (await loginAs(ctx, guest.handle)).post('/api/v1/mud/ticket')).body.error.code).toBe('email_unconfirmed');
    const off = await makeApp(db);
    const v = await makeUser(off);
    expect((await (await loginAs(off, v.handle)).post('/api/v1/mud/ticket')).body.error.code).toBe('mud_off');
  });
});
