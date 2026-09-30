import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildHomesApp } from './homes/server';
import { currentTotp } from './totp';
import { processNext } from './exports/service';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';

describe.skipIf(!dbAvailable)('deleting an account', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: Awaited<ReturnType<typeof buildHomesApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  type P = { id: string; handle: string; c: ReturnType<typeof client> };
  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => { const u = await makeUser(ctx, { role, handle }); return { id: u.id, handle, c: await loginAs(ctx, handle) }; };
  const del = (p: P, over: Record<string, unknown> = {}) => p.c.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: p.handle, posts: 'keep', ...over });
  const put = (p: P, path: string, body: string) => ctx.app.inject({ method: 'PUT', url: `/api/v1/homes/me/file?path=${path}`, payload: body, headers: { origin: 'https://example.test', cookie: `sid=${p.c.sid}`, 'content-type': 'application/octet-stream' } });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ctx.deps.config.limits.trusted_board_quota = 10;
    server = await buildHomesApp(ctx.deps);
    admin = await makeAdmin(ctx);
  });
  afterAll(async () => { await server.close(); await drop(); });

  // A person who has made something in every part of the site.
  async function busyPerson(handle: string) {
    const p = await person(handle, 'trusted');
    const other = await person(`${handle}pal`);
    await p.c.post('/api/v1/boards', { slug: `${handle}-board`, name: 'My board', visibility: 'public' });
    await other.c.post('/api/v1/boards', { slug: `${handle}-open`, name: 'Open', visibility: 'public' }).catch(() => undefined);
    await admin.client.post('/api/v1/boards', { slug: `${handle}-common`, name: 'Common', visibility: 'public' });
    const t = (await p.c.post(`/api/v1/boards/${handle}-common/posts`, { subject: 'My thread', body: 'my words' })).body;
    await other.c.post(`/api/v1/boards/${handle}-common/posts`, { body: 'reply from the pal', reply_to: t.id });
    await p.c.post(`/api/v1/boards/${handle}-common/posts`, { body: 'my reply', reply_to: t.id });
    await put(p, 'index.html', '<h1>hello</h1>');
    await ctx.app.inject({ method: 'POST', url: `/api/v1/widgets/${handle}/guestbook`, payload: { name: 'Fan', message: 'on my page' }, headers: { origin: 'https://x.test' } });
    await put(other, 'index.html', '<h1>pal</h1>');
    await p.c.post(`/api/v1/homes/${handle}pal/guestbook`, { message: `${handle} signed the pal's guestbook` });
    await p.c.post('/api/v1/homes/me/domains', { domain: `${handle}-site.com` });
    await p.c.put(`/api/v1/boards/${handle}-common/watch`);
    await other.c.post(`/api/v1/boards/${handle}-common/posts`, { body: `hello @${handle}`, reply_to: t.id });
    await p.c.post('/api/v1/me/export', { password: TEST_PASSWORD });
    while (await processNext(ctx.deps)) { /* build it */ }
    return { p, other, thread: t.id as string };
  }

  it('asks for the password, the handle typed out and, with two-factor, a current code', async () => {
    const p = await person('careful');
    expect((await del(p, { password: 'wrong' })).body.error.code).toBe('wrong_password');
    expect((await del(p, { confirm_handle: 'someoneelse' })).body.error.code).toBe('confirm_mismatch');
    expect((await del({ ...p, c: client(ctx.app) })).status).toBe(401);
    expect(first(await db.query(`SELECT status FROM users WHERE id = $1`, [p.id])).status).toBe('active');
    // An account with two-factor needs a code, like a login (the second admin is made an admin with one).
    const boss2 = await makeAdmin(ctx);
    const noCode = await boss2.client.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: boss2.handle, posts: 'keep' });
    expect(noCode.body.error.code).toBe('totp_required');
    ctx.clock.advance();
    const withCode = await boss2.client.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: boss2.handle, posts: 'keep', totp: await currentTotp(boss2.secret, ctx.clock.ms) });
    expect(withCode.status).toBe(204);
  });

  it('keeps the site from losing its only admin', async () => {
    await db.query(`UPDATE users SET role = 'user' WHERE role = 'admin' AND id <> $1`, [admin.id]);
    ctx.clock.advance();
    const r = await admin.client.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: admin.handle, posts: 'keep', totp: await currentTotp(admin.secret, ctx.clock.ms) });
    expect(r.body.error.code).toBe('last_admin');
  });

  it('will not delete while the person still runs a ring, and says which', async () => {
    const p = await person('founder', 'trusted');
    await p.c.post('/api/v1/rings', { slug: 'mine-ring', name: 'Mine' });
    const r = await del(p);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'owns_rings', message: expect.stringContaining('mine-ring') });
    await p.c.patch('/api/v1/rings/mine-ring', { archived: true });
    expect((await del(p)).status).toBe(204);
  });

  describe('keeping posts (the default)', () => {
    let s: Awaited<ReturnType<typeof busyPerson>>;
    let filesDir: string;
    let exportFile: string;
    beforeAll(async () => {
      s = await busyPerson('keeper');
      filesDir = ctx.deps.homes.dir(s.p.id);
      const x = first(await db.query(`SELECT id FROM exports WHERE user_id = $1`, [s.p.id])).id;
      exportFile = join(ctx.deps.exportsDir, `${x}.zip`);
      expect(existsSync(filesDir) && existsSync(exportFile)).toBe(true);
    });

    it('deletes, ends the session, and clears the cookie', async () => {
      const r = await del(s.p, { posts: 'keep' });
      expect(r.status).toBe(204);
      expect((await s.p.c.get('/api/v1/me')).status).toBe(401);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, [s.p.id])).n).toBe(0); // ended, not just ignored
      expect(r.res.headers['set-cookie']).toMatch(/sid=;/);
      expect((await client(ctx.app).post('/api/v1/auth/login', { identifier: 'keeper', password: TEST_PASSWORD })).status).toBe(401);
      expect((await client(ctx.app).post('/api/v1/auth/login', { identifier: 'keeper@example.test', password: TEST_PASSWORD })).status).toBe(401);
    });

    it('empties the account of anything personal but keeps the row', async () => {
      const u = first(await db.query(`SELECT handle, email, display_name, bio, status, role, password_hash, public_key, private_key_enc, totp_secret_enc FROM users WHERE id = $1`, [s.p.id]));
      expect(u).toMatchObject({ status: 'deleted', display_name: null, bio: null, role: 'guest', password_hash: 'deleted', public_key: null, private_key_enc: null, totp_secret_enc: null });
      expect(u.handle).toMatch(/^deleted-[0-9a-z]{8}$/);
      expect(u.email).toMatch(/@deleted\.invalid$/);
    });

    it('keeps their posts without their name, and the conversation intact', async () => {
      const thread = (await client(ctx.app).get(`/api/v1/boards/keeper-common/threads/${s.thread}`)).body;
      expect(thread.posts.map((p: { body: string }) => p.body)).toEqual(['my words', 'reply from the pal', 'my reply', 'hello @keeper']);
      expect(thread.posts.filter((p: { author: unknown }) => p.author === null)).toHaveLength(2);
      expect((await client(ctx.app).get('/api/v1/boards/keeper-common/threads')).body.threads[0].reply_count).toBe(3);
    });

    it('deletes the homepage, files, domains and export, and frees nothing early', async () => {
      expect(existsSync(filesDir)).toBe(false);
      expect(existsSync(exportFile)).toBe(false);
      expect((await server.inject({ method: 'GET', url: '/', headers: { host: 'keeper.example-homes.test' } })).statusCode).toBe(404);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM custom_domains WHERE user_id = $1`, [s.p.id])).n).toBe(0);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM homepages WHERE user_id = $1`, [s.p.id])).n).toBe(0);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM exports WHERE user_id = $1`, [s.p.id])).n).toBe(0);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM watches WHERE user_id = $1`, [s.p.id])).n).toBe(0);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [s.p.id])).n).toBe(0);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM guestbook_entries WHERE home_user_id = $1`, [s.p.id])).n).toBe(0); // on their own page
    });

    it('keeps their signature on other people’s guestbooks, without the name', async () => {
      const e = first(await db.query(`SELECT name, message, author_id FROM guestbook_entries WHERE message LIKE 'keeper signed%'`));
      expect(e).toEqual({ name: 'Deleted user', message: "keeper signed the pal's guestbook", author_id: null });
    });

    it('archives boards they owned, and holds the old handle', async () => {
      const b = (await client(ctx.app).get('/api/v1/boards/keeper-board')).body;
      expect(b.archived).toBe(true);
      const inv = (await admin.client.post('/api/v1/admin/invites', {})).body.code;
      const s2 = await client(ctx.app).post('/api/v1/auth/signup', { handle: 'keeper', email: 'k@example.test', password: TEST_PASSWORD, invite: inv, age_confirmed: true });
      expect(s2.body.error.code).toBe('handle_unavailable');
      expect((await server.inject({ method: 'GET', url: '/', headers: { host: 'keeper.example-homes.test' } })).headers.location).toBeUndefined(); // and no redirect to a deleted person
    });

    it('is audited and announced, without keeping what was deleted', async () => {
      const a = first(await db.query(`SELECT actor_id, before, after FROM audit_log WHERE action = 'user.deleted' AND target_id = $1`, [s.p.id]));
      expect(a.actor_id).toBe(s.p.id);
      expect(a.before).toEqual({ handle: 'keeper', role: 'trusted' });
      expect(a.after).toMatchObject({ posts: 'keep', by: 'self' });
      expect(first(await db.query(`SELECT payload FROM events_outbox WHERE type = 'user.deleted' AND payload->>'user_id' = $1`, [s.p.id])).payload).toEqual({ user_id: s.p.id });
    });

    it('cannot be done twice', async () => {
      const r = await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/users/${s.p.id}/delete`, payload: { reason: 'again please', posts: 'keep' }, headers: { origin: 'https://example.test', cookie: `sid=${admin.client.sid}` } });
      expect(r.statusCode).toBe(404);
    });
  });

  describe('erasing posts', () => {
    it('turns each of their posts into a tombstone, and the thread keeps its place', async () => {
      const s = await busyPerson('eraser');
      expect((await del(s.p, { posts: 'erase' })).status).toBe(204);
      const thread = (await client(ctx.app).get(`/api/v1/boards/eraser-common/threads/${s.thread}`)).body;
      expect(thread.posts.map((p: { state: string; body: string | null }) => `${p.state}:${p.body ?? ''}`)).toEqual(['deleted:', 'ok:reply from the pal', 'deleted:', 'ok:hello @eraser']);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM posts p JOIN boards b ON b.id = p.board_id WHERE b.slug = 'eraser-common' AND p.body LIKE '%my words%'`)).n).toBe(0);
      expect((await client(ctx.app).get('/api/v1/boards/eraser-common/threads')).body.threads[0].reply_count).toBe(2); // the pal's two, not the erased one
      expect((await client(ctx.app).get('/api/v1/search?q=words&board=eraser-common')).body.hits).toHaveLength(0);
      const g = first(await db.query(`SELECT message, status, name FROM guestbook_entries WHERE name = 'Deleted user' AND home_user_id = (SELECT id FROM users WHERE handle = 'eraserpal')`));
      expect(g).toEqual({ message: '', status: 'hidden', name: 'Deleted user' });
    });
  });

  describe('by an admin', () => {
    it('needs a reason and an admin, and uses the same rules', async () => {
      const s = await busyPerson('reported');
      const call = (by: { post: (u: string, b?: unknown) => Promise<{ status: number; body: { error?: { code: string } } }> }, body: unknown) => by.post(`/api/v1/admin/users/${s.p.id}/delete`, body);
      expect((await call(s.other.c, { reason: 'because', posts: 'keep' })).status).toBe(403);
      expect((await call(admin.client, { posts: 'keep' })).status).toBe(400);
      expect((await call(admin.client, { reason: 'ok', posts: 'keep' })).status).toBe(400); // reason too short
      expect((await admin.client.post(`/api/v1/admin/users/${admin.id}/delete`, { reason: 'my own', posts: 'keep' })).body.error?.code).toBe('own_account');
      expect((await call(admin.client, { reason: 'they asked by email', posts: 'keep' })).status).toBe(204);
      const a = first(await db.query(`SELECT actor_id, after FROM audit_log WHERE action = 'user.deleted' AND target_id = $1`, [s.p.id]));
      expect(a.actor_id).toBe(admin.id);
      expect(a.after).toMatchObject({ by: 'admin', reason: 'they asked by email' });
    });
  });
});
