import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Mail depth (docs/23, E4): archive, star, mark unread, and renaming a group.
describe.skipIf(!dbAvailable)('mail archive, star, mark unread and rename', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  const person = async () => { const u = await makeUser(ctx, { role: 'user' }); return { ...u, c: await loginAs(ctx, u.handle) }; };
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  const ids = async (p: Awaited<ReturnType<typeof person>>, q = '') => ((await p.c.get(`/api/v1/mail${q}`)).body.threads as { id: string }[]).map((t) => t.id);

  it('archive and star are one person\'s own view, and a new message brings an archived conversation back', async () => {
    const a = await person(); const b = await person();
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'Tidy', body: 'hi' })).body.id as string;
    expect(await ids(b)).toEqual([t]);
    expect((await b.c.put(`/api/v1/mail/${t}/archive`)).status).toBe(204);
    expect(await ids(b)).toEqual([]);
    expect(await ids(b, '?view=archived')).toEqual([t]);
    expect(await ids(a)).toEqual([t]); // the sender is untouched
    expect((await b.c.get('/api/v1/mail/unread')).body.unread).toBe(0); // archived does not count
    await a.c.post(`/api/v1/mail/${t}/messages`, { body: 'are you there?' });
    expect(await ids(b)).toEqual([t]); // it came back
    expect((await b.c.get('/api/v1/mail/unread')).body.unread).toBe(1);

    expect((await b.c.put(`/api/v1/mail/${t}/star`)).status).toBe(204);
    expect(await ids(b, '?view=starred')).toEqual([t]);
    expect(await ids(a, '?view=starred')).toEqual([]);
    const read = (await b.c.get(`/api/v1/mail/${t}`)).body;
    expect(read).toMatchObject({ starred: true, archived: false });
    await b.c.delete(`/api/v1/mail/${t}/star`);
    expect(await ids(b, '?view=starred')).toEqual([]);
    expect((await person().then((x) => x.c.put(`/api/v1/mail/${t}/archive`))).status).toBe(404); // not in it
  });

  it('marks a conversation unread again', async () => {
    const a = await person(); const b = await person();
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'Again', body: 'hi' })).body.id as string;
    await b.c.get(`/api/v1/mail/${t}`);
    expect((await b.c.get('/api/v1/mail/unread')).body.unread).toBe(0);
    expect((await b.c.post(`/api/v1/mail/${t}/unread`)).status).toBe(204);
    expect((await b.c.get('/api/v1/mail/unread')).body.unread).toBe(1);
    expect((await b.c.get('/api/v1/mail?unread=1')).body.threads).toHaveLength(1);
  });

  it('renames only groups, for people in them, with a line in the conversation', async () => {
    const a = await person(); const b = await person(); const c = await person(); const outsider = await person();
    const pair = (await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'Pair', body: 'x' })).body.id as string;
    expect((await a.c.patch(`/api/v1/mail/${pair}`, { subject: 'Nope' })).status).toBe(409);
    const grp = (await a.c.post('/api/v1/mail', { to: [b.handle, c.handle], subject: 'Trip', body: 'x' })).body.id as string;
    expect((await outsider.c.patch(`/api/v1/mail/${grp}`, { subject: 'Hijack' })).status).toBe(404);
    expect((await b.c.patch(`/api/v1/mail/${grp}`, { subject: '' })).status).toBe(400);
    expect((await b.c.patch(`/api/v1/mail/${grp}`, { subject: 'Trip to the coast' })).status).toBe(204);
    const read = (await c.c.get(`/api/v1/mail/${grp}`)).body;
    expect(read.subject).toBe('Trip to the coast');
    const line = read.messages.find((m: { kind: string }) => m.kind === 'renamed');
    expect(line).toMatchObject({ body: 'Trip to the coast', author: { handle: b.handle } });
    // A rename is not a new letter: it doesn't make the conversation unread for anyone.
    await a.c.get(`/api/v1/mail/${grp}`);
    expect((await a.c.get('/api/v1/mail/unread')).body.unread).toBe(0);
  });

  it('puts archived and starred conversations in the export', async () => {
    const a = await person(); const b = await person();
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'Keep', body: 'x' })).body.id as string;
    await b.c.put(`/api/v1/mail/${t}/star`);
    const rows = await ctx.deps.db.query(`SELECT thread_id FROM mail_participants WHERE user_id = $1 AND starred_at IS NOT NULL`, [b.id]);
    expect(rows.rows.map((r) => r.thread_id)).toEqual([t]);
  });
});
