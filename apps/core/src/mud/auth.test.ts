import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from '../test/harness';
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

  it('writes what a builder took down in the game to the audit log, and only for the MUD', async () => {
    const builder = await makeUser(ctx); const author = await makeUser(ctx);
    const call = (body: object, token = secrets.authToken) => client(ctx.app).post('/internal/mud/audit', body, { authorization: `Bearer ${token}`, origin: '' });
    const body = { action: 'mud.guestbook_removed', actor: builder.id, target: author.id, text: 'rude words' };
    expect((await call(body, 'wrong')).status).toBe(401);
    expect((await call({ ...body, action: 'user.suspended' })).status).toBe(400);
    expect((await call({ ...body, actor: 'someone' })).status).toBe(400);
    expect((await call(body)).status).toBe(204);
    const row = (await db.query(`SELECT actor_id, action, target_id, after, origin FROM audit_log WHERE action = 'mud.guestbook_removed'`)).rows[0];
    expect(row).toMatchObject({ actor_id: builder.id, target_id: author.id, after: { text: 'rude words' }, origin: 'system' });
  });

  it('lets admins appoint and remove builders by handle, audited, and only admins', async () => {
    const admin = await makeAdmin(ctx);
    const u = await makeUser(ctx);
    expect((await admin.client.post('/api/v1/admin/mud/builders', { handle: 'nobody-here', reason: 'x y z' })).status).toBe(404);
    expect((await admin.client.post('/api/v1/admin/mud/builders', { handle: u.handle.toUpperCase(), reason: 'builds the swamp' })).status).toBe(201);
    const list = (await admin.client.get('/api/v1/admin/mud/builders')).body.builders;
    const b = list.find((x: { handle: string }) => x.handle === u.handle);
    expect(b).toBeTruthy();
    const c = await loginAs(ctx, u.handle);
    expect((await c.get('/api/v1/admin/mud/builders')).status).toBe(403);
    const t = (await c.post('/api/v1/mud/ticket')).body.ticket;
    expect((await auth({ accountName: u.handle, passphrase: t })).body.builder).toBe(true);
    expect((await admin.client.post('/api/v1/admin/mud/builders/remove', { user_id: b.user_id, op_id: b.op_id, reason: 'done building' })).status).toBe(204);
    const t2 = (await c.post('/api/v1/mud/ticket')).body.ticket;
    expect((await auth({ accountName: u.handle, passphrase: t2 })).body.builder).toBe(false);
    const a = await db.query(`SELECT after FROM audit_log WHERE action = 'user.ops_changed' AND target_id = $1 ORDER BY id`, [u.id]);
    expect(a.rows.map((r) => r.after.granted ?? `-${r.after.revoked}`)).toEqual(['mud:world', '-mud:world']);
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
