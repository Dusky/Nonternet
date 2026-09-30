import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('private mail', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  const person = async (role: 'user' | 'trusted' = 'user') => { const u = await makeUser(ctx, { role }); return { ...u, c: await loginAs(ctx, u.handle) }; };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
  });
  afterAll(async () => drop());

  it('two people write to each other; only they can read it; unread counts follow', async () => {
    const a = await person(); const b = await person(); const c = await person();
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle.toUpperCase()], subject: 'Hello', body: 'Are you coming tonight?' })).body;
    expect(t.id).toMatch(/^mt_/);
    expect((await b.c.get('/api/v1/mail/unread')).body).toEqual({ unread: 1 });
    expect((await a.c.get('/api/v1/mail/unread')).body).toEqual({ unread: 0 });
    const list = (await b.c.get('/api/v1/mail')).body;
    expect(list.threads[0]).toMatchObject({ id: t.id, subject: 'Hello', unread: true, last: { author: a.handle, excerpt: 'Are you coming tonight?' } });
    const read = (await b.c.get(`/api/v1/mail/${t.id}`)).body;
    expect(read.messages.map((m: { body: string }) => m.body)).toEqual(['Are you coming tonight?']);
    expect(read.people.map((p: { handle: string }) => p.handle).sort()).toEqual([a.handle, b.handle].sort());
    expect((await b.c.get('/api/v1/mail/unread')).body).toEqual({ unread: 0 });
    expect((await b.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'Yes!' })).status).toBe(201);
    expect((await a.c.get('/api/v1/mail/unread')).body).toEqual({ unread: 1 });
    // Someone outside can't see it, and it looks like it doesn't exist.
    expect((await c.c.get(`/api/v1/mail/${t.id}`)).status).toBe(404);
    expect((await c.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'hi' })).status).toBe(404);
    expect((await client(ctx.app).get('/api/v1/mail')).status).toBe(401);
  });

  it('runs group conversations of up to ten; latecomers read from when they joined; leaving stops it', async () => {
    const a = await person(); const b = await person(); const c = await person(); const d = await person();
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle, c.handle], subject: 'Picnic', body: 'Saturday?' })).body;
    await b.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'Works for me' });
    expect((await c.c.post(`/api/v1/mail/${t.id}/people`, { handle: d.handle })).status).toBe(204);
    expect((await c.c.post(`/api/v1/mail/${t.id}/people`, { handle: d.handle })).body.error.code).toBe('already_in');
    const forD = (await d.c.get(`/api/v1/mail/${t.id}`)).body;
    expect(forD.messages.map((m: { kind: string }) => m.kind)).toEqual(['joined']); // not the earlier ones
    await d.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'Count me in' });
    expect((await c.c.post(`/api/v1/mail/${t.id}/leave`)).status).toBe(204);
    expect((await c.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'again' })).body.error.code).toBe('left');
    await a.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'after c left' });
    const forC = (await c.c.get(`/api/v1/mail/${t.id}`)).body;
    expect(forC.left).toBe(true);
    expect(forC.messages.map((m: { body: string }) => m.body)).not.toContain('after c left');
    const many = await Promise.all(Array.from({ length: 10 }, () => person()));
    expect((await a.c.post('/api/v1/mail', { to: many.slice(0, 9).map((p) => p.handle), subject: 'Big', body: 'x' })).status).toBe(201);
    expect((await a.c.post('/api/v1/mail', { to: many.map((p) => p.handle), subject: 'Too big', body: 'x' })).status).toBe(400);
  });

  it('only confirmed people take part, and nobody can mail themselves or nobody', async () => {
    const a = await person();
    const guest = await makeUser(ctx, { role: 'guest', verified: false });
    expect((await a.c.post('/api/v1/mail', { to: [guest.handle], subject: 'x', body: 'y' })).body.error.code).toBe('no_such_person');
    expect((await (await loginAs(ctx, guest.handle)).post('/api/v1/mail', { to: [a.handle], subject: 'x', body: 'y' })).body.error.code).toBe('email_unconfirmed');
    expect((await a.c.post('/api/v1/mail', { to: [a.handle], subject: 'x', body: 'y' })).body.error.code).toBe('self');
    expect((await a.c.post('/api/v1/mail', { to: ['nobody-at-all'], subject: 'x', body: 'y' })).body.error.code).toBe('no_such_person');
    expect((await a.c.post('/api/v1/mail', { to: [], subject: 'x', body: 'y' })).status).toBe(400);
  });

  it('blocking keeps someone out of new conversations and hides their messages in shared groups', async () => {
    const a = await person(); const b = await person(); const c = await person();
    const group = (await c.c.post('/api/v1/mail', { to: [a.handle, b.handle], subject: 'Group', body: 'hi all' })).body;
    await b.c.post(`/api/v1/mail/${group.id}/messages`, { body: 'from b before' });
    expect((await a.c.post('/api/v1/me/blocks', { handle: b.handle })).status).toBe(204);
    expect((await a.c.get('/api/v1/me/blocks')).body.blocks.map((x: { handle: string }) => x.handle)).toEqual([b.handle]);
    expect((await b.c.post('/api/v1/mail', { to: [a.handle], subject: 'x', body: 'y' })).body.error.code).toBe('cannot_mail');
    expect((await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'x', body: 'y' })).body.error.code).toBe('cannot_mail');
    const d = await person();
    const other = (await d.c.post('/api/v1/mail', { to: [a.handle], subject: 'Other', body: 'hey' })).body;
    expect((await d.c.post(`/api/v1/mail/${other.id}/people`, { handle: b.handle })).body.error.code).toBe('cannot_mail');
    const seen = (await a.c.get(`/api/v1/mail/${group.id}`)).body.messages.map((m: { body: string }) => m.body);
    expect(seen).toContain('hi all');
    expect(seen).not.toContain('from b before');
    const admin = await makeAdmin(ctx);
    expect((await a.c.post('/api/v1/me/blocks', { handle: admin.handle })).body.error.code).toBe('admin');
    await a.c.post('/api/v1/me/blocks/remove', { handle: b.handle });
    expect((await b.c.post('/api/v1/mail', { to: [a.handle], subject: 'x', body: 'y' })).status).toBe(201);
  });

  it('lets people delete their own messages and report someone else’s, which shows admins only that message', async () => {
    const a = await person(); const b = await person();
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'Rude', body: 'first' })).body;
    const r = (await b.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'something nasty' })).body;
    await b.c.post(`/api/v1/mail/${t.id}/messages`, { body: 'something private' });
    const msgs = (await a.c.get(`/api/v1/mail/${t.id}`)).body.messages;
    const mine = msgs.find((m: { body: string }) => m.body === 'first');
    expect((await b.c.delete(`/api/v1/mail/${t.id}/messages/${mine.id}`)).status).toBe(404); // not theirs
    expect((await a.c.post(`/api/v1/mail/${t.id}/messages/${mine.id}/report`, { category: 'abuse' })).body.error.code).toBe('self');
    expect((await a.c.post(`/api/v1/mail/${t.id}/messages/${r.id}/report`, { category: 'abuse', note: 'see this' })).status).toBe(201);
    expect((await a.c.post(`/api/v1/mail/${t.id}/messages/${r.id}/report`, { category: 'abuse' })).body.error.code).toBe('already_reported');
    const admin = await makeAdmin(ctx);
    const rep = (await admin.client.get('/api/v1/reports')).body.reports.find((x: { target: { id: string } }) => x.target.id === r.id);
    expect(rep).toMatchObject({ target: { type: 'mail_message', handle: b.handle }, excerpt: 'something nasty' });
    expect(JSON.stringify(rep)).not.toContain('something private');
    expect((await a.c.delete(`/api/v1/mail/${t.id}/messages/${mine.id}`)).status).toBe(204);
    const after = (await b.c.get(`/api/v1/mail/${t.id}`)).body.messages.find((m: { id: string }) => m.id === mine.id);
    expect(after).toMatchObject({ deleted: true, body: '' });
  });

  it('keeps a deleted person’s messages without their name, or erases them, as they chose', async () => {
    const a = await person(); const b = await person();
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'Bye', body: 'from a' })).body;
    const admin = await makeAdmin(ctx);
    expect((await admin.client.post(`/api/v1/admin/users/${a.id}/delete`, { posts: 'keep', reason: 'asked to leave' })).status).toBe(204);
    const seen = (await b.c.get(`/api/v1/mail/${t.id}`)).body;
    expect(seen.messages[0]).toMatchObject({ body: 'from a', author: { handle: null } });
    expect(seen.people.map((p: { handle: string | null }) => p.handle)).toEqual([b.handle]);
    const c = await person();
    const t2 = (await c.c.post('/api/v1/mail', { to: [b.handle], subject: 'Bye 2', body: 'from c' })).body;
    await admin.client.post(`/api/v1/admin/users/${c.id}/delete`, { posts: 'erase', reason: 'asked to erase' });
    expect((await b.c.get(`/api/v1/mail/${t2.id}`)).body.messages[0]).toMatchObject({ body: '', deleted: true });
    expect((await db.query(`SELECT count(*)::int AS n FROM mail_messages WHERE body = 'from c'`)).rows[0]!.n).toBe(0);
  });
});
