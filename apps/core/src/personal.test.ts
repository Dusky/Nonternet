import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, ORIGIN, TEST_PASSWORD } from './test/harness';
import { processNext } from './exports/service';
import { deleteAccount } from './deletion';
import { coarseLastSeen, sendDigests } from './personal';

describe('coarse last seen', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  it('says today, this week or a while ago, and nothing when hidden or unknown', () => {
    expect(coarseLastSeen(new Date(now - 3_600_000), true, now)).toBe('today');
    expect(coarseLastSeen(new Date(now - 3 * 86_400_000), true, now)).toBe('this_week');
    expect(coarseLastSeen(new Date(now - 30 * 86_400_000), true, now)).toBe('a_while');
    expect(coarseLastSeen(new Date(now - 1000), false, now)).toBeNull();
    expect(coarseLastSeen(null, true, now)).toBeNull();
  });
});

describe.skipIf(!dbAvailable)('personal touches', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  const png = (w = 40, h = 20) => sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } }).png().toBuffer();
  const upload = (c: Awaited<ReturnType<typeof loginAs>>, body: Buffer | string) =>
    ctx.app.inject({ method: 'PUT', url: '/api/v1/me/avatar', payload: body, headers: { origin: ORIGIN, cookie: `sid=${c.sid}`, 'content-type': 'application/octet-stream' } });

  it('keeps a status line and away flag, shown on the profile and in who is online', async () => {
    const u = await makeUser(ctx, { handle: 'statusy' });
    const c = await loginAs(ctx, u.handle);
    expect((await c.patch('/api/v1/me', { status_line: 'Soldering things', away: true })).status).toBe(200);
    const p = (await c.get('/api/v1/users/statusy')).body;
    expect(p).toMatchObject({ status_line: 'Soldering things', away: true });
    expect((await c.patch('/api/v1/me', { status_line: 'two\nlines' })).status).toBe(400);
    expect((await c.patch('/api/v1/me', { status_line: 'x'.repeat(81) })).status).toBe(400);
    expect((await c.patch('/api/v1/me', { status_line: '' })).status).toBe(200);
    expect((await c.get('/api/v1/users/statusy')).body.status_line).toBeNull();
  });

  it('draws an uploaded avatar again as 256×256 WebP, serves it to members only, and lets the owner remove it', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    const res = await upload(c, await png());
    expect(res.statusCode).toBe(200);
    const list = (await c.get('/api/v1/avatars')).body.avatars;
    expect(list[u.id]).toBeGreaterThan(0);
    const img = await ctx.app.inject({ method: 'GET', url: `/api/v1/avatars/${u.id}`, headers: { cookie: `sid=${c.sid}` } });
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.rawPayload).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 256, 256]);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/avatars/${u.id}` })).statusCode).toBe(401); // a visitor can't
    expect((await c.delete('/api/v1/me/avatar')).status).toBe(204);
    expect((await c.get('/api/v1/avatars')).body.avatars[u.id]).toBeUndefined();
  });

  it('refuses things that are not pictures, other formats, and anything too big', async () => {
    const c = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await upload(c, 'just some text')).statusCode).toBe(400);
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).gif().toBuffer();
    expect((await upload(c, gif)).statusCode).toBe(400);
    expect((await upload(c, Buffer.alloc(2 * 1024 * 1024 + 10))).statusCode).toBe(413);
  });

  it('lets an admin remove an avatar with a reason, on the record', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await upload(c, await png());
    const admin = await makeAdmin(ctx);
    expect((await admin.client.delete(`/api/v1/admin/users/${u.id}/avatar`)).status).toBe(400); // a reason is needed
    const r = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/admin/users/${u.id}/avatar`, payload: { reason: 'Not suitable' }, headers: { origin: ORIGIN, cookie: `sid=${admin.client.sid}` } });
    expect(r.statusCode).toBe(204);
    expect((await c.get('/api/v1/avatars')).body.avatars[u.id]).toBeUndefined();
    const row = await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action = 'user.avatar_removed' AND target_id = $1`, [u.id]);
    expect(row.rowCount).toBe(1);
  });

  it('shows a profile with recent public posts, a homepage card and a coarse last seen that can be hidden', async () => {
    const owner = await makeUser(ctx, { role: 'trusted' });
    const o = await loginAs(ctx, owner.handle);
    await o.post('/api/v1/boards', { slug: 'pubb', name: 'Public', visibility: 'public' });
    await o.post('/api/v1/boards', { slug: 'privb', name: 'Private', visibility: 'private' });
    await o.post('/api/v1/boards/pubb/posts', { subject: 'Out in the open', body: 'hello' });
    await o.post('/api/v1/boards/privb/posts', { subject: 'Secret', body: 'shh' });
    const viewer = await loginAs(ctx, (await makeUser(ctx)).handle);
    const p = (await viewer.get(`/api/v1/users/${owner.handle}`)).body;
    expect(p.recent_posts.map((x: { subject: string }) => x.subject)).toEqual(['Out in the open']);
    expect(p.last_seen).toBe('today');
    await o.patch('/api/v1/me', { show_last_seen: false });
    expect((await viewer.get(`/api/v1/users/${owner.handle}`)).body.last_seen).toBeNull();
  });

  it('searches the people directory, filters by role, and never lists guests', async () => {
    await makeUser(ctx, { handle: 'zorbapeople' });
    await makeUser(ctx, { handle: 'zorbaunverified', verified: false, role: 'guest' });
    const t = await makeUser(ctx, { handle: 'zorbatrusted', role: 'trusted' });
    const c = await loginAs(ctx, t.handle);
    const all = (await c.get('/api/v1/people?q=zorba')).body.people.map((p: { handle: string }) => p.handle).sort();
    expect(all).toEqual(['zorbapeople', 'zorbatrusted']);
    const trusted = (await c.get('/api/v1/people?q=zorba&role=trusted')).body.people.map((p: { handle: string }) => p.handle);
    expect(trusted).toEqual(['zorbatrusted']);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/people' })).statusCode).toBe(401);
  });

  it('keeps a notification you switched off from being made, and mutes a board except for mentions', async () => {
    const owner = await makeUser(ctx, { role: 'trusted' });
    const o = await loginAs(ctx, owner.handle);
    const slug = `n${Math.random().toString(36).slice(2, 7)}`;
    await o.post('/api/v1/boards', { slug, name: 'Notes', visibility: 'public' });
    const th = (await o.post(`/api/v1/boards/${slug}/posts`, { subject: 'Hello', body: 'First' })).body;
    const other = await makeUser(ctx);
    const x = await loginAs(ctx, other.handle);
    const unread = async () => (await o.get('/api/v1/notifications')).body.unread as number;
    // Default: a reply reaches the owner.
    await x.post(`/api/v1/boards/${slug}/posts`, { body: 'reply one', reply_to: th.id });
    expect(await unread()).toBe(1);
    // Switch replies off on the site: the next one doesn't.
    expect((await o.put('/api/v1/me/notification-prefs', { kind: 'reply', enabled: false })).status).toBe(204);
    await x.post(`/api/v1/boards/${slug}/posts`, { body: 'reply two', reply_to: th.id });
    expect(await unread()).toBe(1);
    expect((await o.get('/api/v1/me/personal')).body.prefs.reply).toBe(false);
    // Back on, but the board muted: replies are quiet, a mention still gets through.
    await o.put('/api/v1/me/notification-prefs', { kind: 'reply', enabled: true });
    expect((await o.put(`/api/v1/boards/${slug}/mute`)).status).toBe(204);
    await x.post(`/api/v1/boards/${slug}/posts`, { body: 'reply three', reply_to: th.id });
    expect(await unread()).toBe(1);
    await x.post(`/api/v1/boards/${slug}/posts`, { body: `hey @${owner.handle}, look`, reply_to: th.id });
    expect(await unread()).toBe(2);
    expect((await o.get('/api/v1/me/personal')).body.muted_boards).toEqual([{ slug, name: 'Notes' }]);
    expect((await o.delete(`/api/v1/boards/${slug}/mute`)).status).toBe(204);
    // You can't mute a board you can't read.
    await o.post('/api/v1/boards', { slug: `${slug}p`, name: 'Hidden', visibility: 'private' });
    expect((await x.put(`/api/v1/boards/${slug}p/mute`)).status).toBe(404);
  });

  it('a muted mail conversation stays in the inbox but stops counting as unread', async () => {
    const a = await loginAs(ctx, (await makeUser(ctx, { handle: 'mutea' })).handle);
    const b = await loginAs(ctx, (await makeUser(ctx, { handle: 'muteb' })).handle);
    const t = (await a.post('/api/v1/mail', { to: ['muteb'], subject: 'Chatter', body: 'hi' })).body;
    expect((await b.get('/api/v1/mail')).body.unread).toBe(1);
    expect((await b.put(`/api/v1/mail/${t.id}/mute`)).status).toBe(204);
    const inbox = (await b.get('/api/v1/mail')).body;
    expect(inbox.unread).toBe(0);
    expect(inbox.threads[0]).toMatchObject({ id: t.id, muted: true, unread: true });
    expect((await b.get('/api/v1/mail/unread')).body.unread).toBe(0);
    expect((await a.put(`/api/v1/mail/${t.id}/mute`)).status).toBe(204);
    expect((await b.delete(`/api/v1/mail/${t.id}/mute`)).status).toBe(204);
    expect((await b.get('/api/v1/mail')).body.unread).toBe(1);
  });

  it('sends one daily digest, only when there is something missed and only to people who asked', async () => {
    const asker = await makeUser(ctx, { handle: 'digestee' });
    const quiet = await makeUser(ctx, { handle: 'nodigest' });
    const d = await loginAs(ctx, asker.handle);
    const s = await loginAs(ctx, (await makeUser(ctx, { handle: 'digestsender' })).handle);
    expect((await d.get('/api/v1/me/personal')).body.can_email).toBe(true);
    await d.patch('/api/v1/me', { email_digest: true });
    await s.post('/api/v1/mail', { to: ['digestee', 'nodigest'], subject: 'News', body: 'something' });
    const before = ctx.mailer.sent.length;
    expect(await sendDigests(ctx.deps)).toBe(1);
    const mail = ctx.mailer.sent.slice(before).find((m) => m.to === asker.email)!;
    expect(mail.subject).toContain('thing');
    expect(ctx.mailer.sent.slice(before).some((m) => m.to === quiet.email)).toBe(false);
    expect(await sendDigests(ctx.deps)).toBe(0); // not again today
  });

  it('puts settings and the avatar in the export, and erasing the account removes the picture and the choices', async () => {
    const u = await makeUser(ctx, { handle: 'exporty' });
    const c = await loginAs(ctx, u.handle);
    await c.patch('/api/v1/me', { status_line: 'Around', email_digest: true });
    await c.put('/api/v1/me/notification-prefs', { kind: 'watch', enabled: false });
    await upload(c, await png());
    const r = await c.post('/api/v1/me/export', { password: TEST_PASSWORD });
    expect(r.status).toBe(202);
    await processNext(ctx.deps);
    const dl = await ctx.app.inject({ method: 'GET', url: `/api/v1/me/exports/${r.body.id}/download`, headers: { cookie: `sid=${c.sid}` } });
    const files = unzipSync(new Uint8Array(dl.rawPayload));
    const settings = JSON.parse(strFromU8(files['settings.json']!));
    expect(settings).toMatchObject({ status_line: 'Around', email_digest: true, notifications: { watch: false } });
    expect(files['avatar.webp']!.length).toBeGreaterThan(100);
    await deleteAccount(ctx.deps, u.id, { posts: 'keep', actor: null }, {});
    const left = await ctx.deps.db.query(`SELECT (SELECT count(*) FROM notification_prefs WHERE user_id = $1) AS prefs, (SELECT avatar_at FROM users WHERE id = $1) AS avatar, (SELECT status_line FROM users WHERE id = $1) AS line`, [u.id]);
    expect(left.rows[0]).toMatchObject({ prefs: '0', avatar: null, line: null });
    const admin = await makeAdmin(ctx);
    expect((await admin.client.get(`/api/v1/avatars/${u.id}`)).status).toBe(404);
  });
});
