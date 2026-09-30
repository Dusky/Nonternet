import { createHash, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from '../test/harness';
import { parsePublicKey } from './service';
import { bbsSecrets } from './secrets';

// An OpenSSH ed25519 public key line, built the way ssh-keygen writes it.
function ed25519Line(comment = 'me@laptop'): { line: string; fingerprint: string } {
  const { publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const str = (b: Buffer) => { const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); };
  const blob = Buffer.concat([str(Buffer.from('ssh-ed25519')), str(raw)]);
  return { line: `ssh-ed25519 ${blob.toString('base64')} ${comment}`, fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}` };
}

describe('parsing SSH public keys', () => {
  it('reads a key line and gives the fingerprint OpenSSH shows', () => {
    const k = ed25519Line();
    expect(parsePublicKey(`  ${k.line}\n`)).toMatchObject({ type: 'ssh-ed25519', comment: 'me@laptop', fingerprint: k.fingerprint });
  });
  it('refuses things that are not public keys', () => {
    const k = ed25519Line();
    const [, blob] = k.line.split(' ');
    for (const bad of ['', 'hello', `ssh-rsa ${blob}`, `ssh-dss ${blob}`, 'ssh-ed25519 not/base64!!', '-----BEGIN OPENSSH PRIVATE KEY-----']) {
      expect(() => parsePublicKey(bad), bad).toThrow();
    }
  });
});

describe.skipIf(!dbAvailable)('the BBS in core', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  const bbs = bbsSecrets('b'.repeat(40));
  const internal = (path: string, body: unknown, token = bbs.authToken) => ctx.app.inject({ method: 'POST', url: `/internal/bbs/${path}`, payload: body as object, headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ctx.deps.bbs = bbs;
  });
  afterAll(async () => drop());

  it('signs a caller in with their terminal password and gives the BBS an ordinary session', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    expect((await c.put('/api/v1/me/terminal-password', { password: TEST_PASSWORD, terminal_password: 'terminal pass 1' })).status).toBeLessThan(300);
    expect((await internal('login', { method: 'password', handle: u.handle, secret: 'nope', via: 'telnet', node: 1 })).statusCode).toBe(401);
    expect((await internal('login', { method: 'password', handle: u.handle, secret: 'terminal pass 1', via: 'telnet', node: 1 }, 'wrong')).statusCode).toBe(401);
    const r = await internal('login', { method: 'password', handle: u.handle.toUpperCase(), secret: 'terminal pass 1', via: 'telnet', node: 1 });
    expect(r.statusCode).toBe(200);
    const { token, call_id, user } = r.json();
    expect(user).toEqual({ id: u.id, handle: u.handle, role: 'user' });
    // The session works on the public API like any other.
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `sid=${token}` } });
    expect(me.json().user.handle).toBe(u.handle);
    const calls = (await c.get('/api/v1/bbs/last-callers')).body.callers;
    expect(calls[0]).toMatchObject({ handle: u.handle, node: 1, via: 'telnet', left_at: null });
    expect((await db.query(`SELECT services FROM activity_days WHERE user_id = $1`, [u.id])).rows[0]?.services).toContain('bbs');
    expect((await internal('logout', { token, call_id })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `sid=${token}` } })).statusCode).toBe(401);
    expect((await c.get('/api/v1/bbs/last-callers')).body.callers[0].left_at).not.toBeNull();
  });

  it('takes a one-use ticket from the Terminal window, once, and only for the BBS', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const t = (await c.post('/api/v1/bbs/ticket')).body.ticket;
    expect((await internal('login', { method: 'ticket', handle: u.handle, secret: t, via: 'web', node: 2 })).statusCode).toBe(200);
    expect((await internal('login', { method: 'ticket', handle: u.handle, secret: t, via: 'web', node: 2 })).statusCode).toBe(401);
    const irc = (await c.post('/api/v1/irc/ticket')).body.ticket;
    if (irc) expect((await internal('login', { method: 'ticket', handle: u.handle, secret: irc, via: 'web', node: 2 })).statusCode).toBe(401);
    const g = await makeUser(ctx, { role: 'guest', verified: false });
    expect((await (await loginAs(ctx, g.handle)).post('/api/v1/bbs/ticket')).body.error.code).toBe('email_unconfirmed');
  });

  it('manages SSH keys in Settings, signs in by key, and exports them', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const k = ed25519Line('laptop');
    const added = await c.post('/api/v1/me/ssh-keys', { name: '', public_key: k.line });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ name: 'laptop', type: 'ssh-ed25519', fingerprint: k.fingerprint, last_used_at: null });
    expect((await c.post('/api/v1/me/ssh-keys', { public_key: k.line })).body.error.code).toBe('key_taken');
    const other = await makeUser(ctx);
    expect((await (await loginAs(ctx, other.handle)).post('/api/v1/me/ssh-keys', { public_key: k.line })).body.error.code).toBe('key_taken');
    expect((await internal('has-keys', { handle: u.handle })).json()).toEqual({ keys: true });
    expect((await internal('login-key', { handle: other.handle, fingerprint: k.fingerprint, node: 3 })).statusCode).toBe(401);
    const r = await internal('login-key', { handle: u.handle, fingerprint: k.fingerprint, node: 3 });
    expect(r.json().user.handle).toBe(u.handle);
    expect((await c.get('/api/v1/me/ssh-keys')).body.keys[0].last_used_at).not.toBeNull();
    const log = (await db.query(`SELECT action FROM audit_log WHERE target_id = $1 AND action LIKE 'ssh_key.%'`, [u.id])).rows;
    expect(log).toEqual([{ action: 'ssh_key.added' }]);
    await c.delete(`/api/v1/me/ssh-keys/${added.body.id}`);
    expect((await internal('login-key', { handle: u.handle, fingerprint: k.fingerprint, node: 3 })).statusCode).toBe(401);
  });

  it('tells the BBS which callers to drop once they are suspended or signed out, and their current role', async () => {
    const admin = await makeAdmin(ctx);
    const a = await makeUser(ctx); const b = await makeUser(ctx);
    const login = async (h: string) => { const c = await loginAs(ctx, h); const t = (await c.post('/api/v1/bbs/ticket')).body.ticket; return (await internal('login', { method: 'ticket', handle: h, secret: t, via: 'ssh', node: 9 })).json().token as string; };
    const ta = await login(a.handle); const tb = await login(b.handle);
    const report = async () => (await internal('nodes', { nodes: [
      { node: 1, token: ta, via: 'ssh', where: 'Main menu', since: new Date().toISOString() },
      { node: 2, token: tb, via: 'telnet', where: 'Reading Lobby', since: new Date().toISOString() },
    ] })).json().nodes;
    expect((await report()).map((n: { ok: boolean }) => n.ok)).toEqual([true, true]);
    await admin.client.post(`/api/v1/admin/users/${a.id}/suspend`, { reason: 'test' });
    await admin.client.post(`/api/v1/admin/users/${b.id}/role`, { role: 'trusted', reason: 'test' });
    const after = await report();
    expect(after[0]).toEqual({ node: 1, ok: false });
    expect(after[1]).toMatchObject({ node: 2, ok: true, user: { handle: b.handle, role: 'trusted' } });
    // Who's online includes the BBS node.
    const online = (await (await loginAs(ctx, b.handle)).get('/api/v1/online')).body.people;
    expect(online.find((p: { handle: string }) => p.handle === b.handle)).toMatchObject({ bbs: { node: 2, where: 'Reading Lobby' } });
    expect((await client(ctx.app).get('/api/v1/online')).status).toBe(401);
  });
});
