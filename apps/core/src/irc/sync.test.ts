import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from '../test/harness';
import { ergoAvailable, ircLogin, startErgo, type IrcClientLike, type RunningErgo } from '../test/ergo';
import { newId } from '../crypto';
import { ergoChannels } from './api';
import { ircSecrets } from './secrets';
import { ircOnline, refreshPresence, startIrcSync, type IrcSync } from './sync';

const SECRET = 'irc-sync-test-secret-0123456789abcdefghijk';
const until = async (what: string, fn: () => Promise<boolean> | boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); }
};

describe.skipIf(!dbAvailable || !ergoAvailable)('keeping IRC in step with the site', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let ergo: RunningErgo;
  let sync: IrcSync;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const logs: string[] = [];
  const amodes = async (channel: string) => (await sync.bot.call(`CS AMODE ${channel}`)).filter((n) => /receives mode/.test(n));
  const registered = async () => new Map((await ergoChannels(ctx.deps.irc!)).filter((c) => c.registered).map((c) => [c.name, c]));
  const connect = async (handle: string): Promise<IrcClientLike> => {
    const c = await loginAs(ctx, handle);
    const { ticket } = (await c.post('/api/v1/irc/ticket')).body;
    const r = await ircLogin(ctx.deps.irc!, handle, ticket);
    if (!r.ok) throw new Error(`${handle} could not connect: ${r.reason}`);
    return r.client;
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db, { irc: { secrets: ircSecrets(SECRET), host: '127.0.0.1', port: 1, apiUrl: 'http://127.0.0.1:1' } });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    ergo = await startErgo(ctx.deps.config, { coreUrl: `http://127.0.0.1:${(ctx.app.server.address() as { port: number }).port}`, secret: SECRET });
    Object.assign(ctx.deps.irc!, ergo.irc);
    admin = await makeAdmin(ctx);
    sync = startIrcSync(ctx.deps, (m) => logs.push(m), { tickMs: 3_600_000, presenceMs: 3_600_000 });
    await until('the bot', () => sync.bot.ready);
  }, 60_000);
  afterAll(async () => { sync?.stop(); await ergo?.stop(); await drop(); });

  it('registers the official channels to the bot, with admins as ops', async () => {
    const r = await sync.runNow({ full: true });
    expect(r?.failures, JSON.stringify(r?.failures)).toEqual([]);
    const reg = await registered();
    expect(reg.get('#lobby')?.owner).toBe('sitebot');
    expect(reg.get('#help')?.owner).toBe('sitebot');
    expect(await amodes('#help')).toContain(`Account ${admin.handle.toLowerCase()} receives mode +o`);
    // A second pass has nothing to do.
    expect(await sync.runNow()).toMatchObject({ registered: [], amodesSet: 0, failures: [] });
  }, 30_000);

  it('gives each ring a channel with its ops, and drops it when the ring is archived', async () => {
    const founder = await makeUser(ctx, { role: 'trusted' });
    const op = await makeUser(ctx);
    const id = newId('r');
    await db.query(`INSERT INTO rings (id, slug, name, description, founder_id, join_policy) VALUES ($1, 'synths', 'Synths', 'Knobs and patch cables', $2, 'open')`, [id, founder.id]);
    await db.query(`INSERT INTO scoped_roles (id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1, $2, 'ring_op', 'ring', $3, $4)`, [newId('o'), op.id, id, founder.id]);
    const r = await sync.runNow();
    expect(r?.registered).toContain('#ring-synths');
    expect((await registered()).get('#ring-synths')?.topic).toBe('Synths: Knobs and patch cables');
    const modes = await amodes('#ring-synths');
    expect(modes).toEqual(expect.arrayContaining([`Account ${founder.handle.toLowerCase()} receives mode +o`, `Account ${op.handle.toLowerCase()} receives mode +o`]));
    expect((await db.query(`SELECT irc_channel FROM rings WHERE id = $1`, [id])).rows[0]!.irc_channel).toBe('#ring-synths');

    await db.query(`DELETE FROM scoped_roles WHERE user_id = $1`, [op.id]);
    expect((await sync.runNow())?.amodesRemoved).toBe(1);
    expect(await amodes('#ring-synths')).not.toContain(`Account ${op.handle.toLowerCase()} receives mode +o`);

    await db.query(`UPDATE rings SET archived_at = now() WHERE id = $1`, [id]);
    expect((await sync.runNow())?.unregistered).toEqual(['#ring-synths']);
    expect((await registered()).has('#ring-synths')).toBe(false);
  }, 30_000);

  it('lets trusted users register channels within the quota, as owner', async () => {
    const plain = await makeUser(ctx);
    expect((await (await loginAs(ctx, plain.handle)).post('/api/v1/irc/channels', { name: '#mine' })).status).toBe(403);
    const t = await makeUser(ctx, { role: 'trusted' });
    const c = await loginAs(ctx, t.handle);
    expect((await c.post('/api/v1/irc/channels', { name: '#ring-fake' })).body.error.code).toBe('bad_name');
    expect((await c.post('/api/v1/irc/channels', { name: '#lobby' })).body.error.code).toBe('name_taken');
    expect((await c.post('/api/v1/irc/channels', { name: 'no hash' })).body.error.code).toBe('bad_name');
    expect((await c.post('/api/v1/irc/channels', { name: '#Tape-Loops' })).body).toEqual({ name: '#tape-loops' });
    ctx.deps.config.limits.trusted_channel_quota = 1;
    expect((await c.post('/api/v1/irc/channels', { name: '#second' })).body.error.code).toBe('quota_reached');
    ctx.deps.config.limits.trusted_channel_quota = 3;
    await sync.runNow();
    expect((await registered()).get('#tape-loops')?.owner).toBe('sitebot');
    expect(await amodes('#tape-loops')).toContain(`Account ${t.handle.toLowerCase()} receives mode +q`);
    const list = (await c.get('/api/v1/irc/channels')).body.channels;
    expect(list.find((x: { name: string }) => x.name === '#tape-loops')).toMatchObject({ kind: 'user', owner: t.handle });
    expect(list.find((x: { name: string }) => x.name === '#lobby')).toMatchObject({ kind: 'official' });
    // Someone else cannot remove it; an admin can, with a reason.
    expect((await (await loginAs(ctx, plain.handle)).post('/api/v1/irc/channels/remove', { name: '#tape-loops' })).status).toBe(403);
    expect((await admin.client.post('/api/v1/irc/channels/remove', { name: '#tape-loops' })).body.error.code).toBe('reason_required');
    expect((await c.post('/api/v1/irc/channels/remove', { name: '#tape-loops' })).status).toBe(204);
    expect((await sync.runNow())?.unregistered).toEqual(['#tape-loops']);
    const a = await db.query(`SELECT action FROM audit_log WHERE target_id = '#tape-loops' ORDER BY id`);
    expect(a.rows.map((x) => x.action)).toEqual(['irc.channel_registered', 'irc.channel_removed']);
  }, 30_000);

  it('disconnects a suspended person at once and lets them back after', async () => {
    const u = await makeUser(ctx);
    const client = await connect(u.handle);
    let closed = false;
    client.on('close', () => { closed = true; });
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
    const r = await sync.runNow();
    expect(r?.suspended).toContain(u.handle.toLowerCase());
    await until('the disconnect', () => closed);
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [u.id]);
    expect((await sync.runNow())?.unsuspended).toContain(u.handle.toLowerCase());
    (await connect(u.handle)).quit();
  }, 30_000);

  it('holds a renamed person’s old nick and lets them in under the new one', async () => {
    const u = await makeUser(ctx);
    const old = await connect(u.handle);
    let closed = false;
    old.on('close', () => { closed = true; });
    const renamed = `${u.handle}x`;
    const res = await admin.client.post(`/api/v1/admin/users/${u.id}/rename`, { handle: renamed, reason: 'asked for it' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = await sync.runNow();
    expect(r?.suspended).toContain(u.handle.toLowerCase());
    await until('the old session to drop', () => closed);
    (await connect(renamed)).quit();
  }, 30_000);

  it('makes a new admin an op in the official channels, and takes it away again', async () => {
    const u = await makeUser(ctx);
    await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [u.id]);
    await sync.runNow();
    expect(await amodes('#lobby')).toContain(`Account ${u.handle.toLowerCase()} receives mode +o`);
    await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [u.id]);
    await sync.runNow();
    expect(await amodes('#lobby')).not.toContain(`Account ${u.handle.toLowerCase()} receives mode +o`);
  }, 30_000);

  it('posts an announcement to the lobby once, and knows who is online', async () => {
    const u = await makeUser(ctx);
    const client = await connect(u.handle);
    const heard: string[] = [];
    client.on('notice', (e: { target: string; message: string }) => { if (e.target === '#lobby') heard.push(e.message); });
    await until('the auto-join', async () => { await refreshPresence(sync.bot); return ircOnline().accounts.includes(u.handle.toLowerCase()); });
    expect((await admin.client.post('/api/v1/admin/announcements', { title: 'Maintenance tonight', body: 'Back by ten.', irc: true })).status).toBe(201);
    await sync.runNow();
    await until('the announcement', () => heard.length > 0);
    expect(heard).toEqual(['Maintenance tonight: Back by ten.']);
    await sync.runNow();
    await new Promise((r) => setTimeout(r, 300));
    expect(heard).toHaveLength(1);
    expect((await (await loginAs(ctx, u.handle)).get('/api/v1/online')).body.irc).toContain(u.handle.toLowerCase());
    client.quit();
  }, 30_000);

  it('gives admins the server’s status, disconnects and address bans, each audited', async () => {
    const o = (await admin.client.get('/api/v1/admin/irc')).body;
    expect(o).toMatchObject({ configured: true, bot_connected: true, reachable: true });
    expect(o.status.version).toMatch(/^\d+\.\d+/);
    expect(o.channels.map((c: { name: string }) => c.name)).toContain('#lobby');

    const u = await makeUser(ctx);
    const client = await connect(u.handle);
    let closed = false;
    client.on('close', () => { closed = true; });
    expect((await admin.client.post('/api/v1/admin/irc/disconnect', { nick: u.handle, reason: 'cool it' })).status).toBe(204);
    await until('the kill', () => closed);
    expect((await admin.client.post('/api/v1/admin/irc/disconnect', { nick: 'nobodyhere', reason: 'x y z' })).status).toBe(404);

    expect((await admin.client.post('/api/v1/admin/irc/bans', { target: 'not-an-ip', reason: 'spam' })).status).toBe(400);
    expect((await admin.client.post('/api/v1/admin/irc/bans', { target: '192.0.2.0/24', duration: '1d', reason: 'spam wave' })).status).toBe(201);
    expect((await admin.client.get('/api/v1/admin/irc/bans')).body.bans.join('\n')).toContain('192.0.2.0/24');
    expect((await admin.client.post('/api/v1/admin/irc/bans/remove', { target: '192.0.2.0/24' })).status).toBe(204);
    expect((await admin.client.get('/api/v1/admin/irc/bans')).body.bans.join('\n')).not.toContain('192.0.2.0/24');
    const a = await db.query(`SELECT action FROM audit_log WHERE action LIKE 'irc.%' AND action <> 'irc.channel_registered' AND action <> 'irc.channel_removed' ORDER BY id`);
    expect(a.rows.map((x) => x.action)).toEqual(['irc.disconnected', 'irc.ban_added', 'irc.ban_removed']);
    const plain = await makeUser(ctx);
    expect((await (await loginAs(ctx, plain.handle)).get('/api/v1/admin/irc')).status).toBe(403);
  }, 30_000);
});
