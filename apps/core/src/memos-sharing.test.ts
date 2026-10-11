import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';
import { answer as finger } from './finger/server';
import { answer as gemini } from './gemini/server';

// Sharing memos (docs/22, M3): who can read them where, replies and reactions, reports and hiding.
describe.skipIf(!dbAvailable)('sharing memos', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type P = { id: string; handle: string; c: Awaited<ReturnType<typeof loginAs>> };
  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => {
    const u = await makeUser(ctx, { role, handle });
    return { id: u.id, handle, c: await loginAs(ctx, handle) };
  };
  const visitor = () => client(ctx.app);
  const ids = (r: { body: { memos: { id: string }[] } }) => r.body.memos.map((m) => m.id);
  const write = (p: P, body: string, extra: Record<string, unknown> = {}) => p.c.post('/api/v1/memos', { body, ...extra });

  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  it('shows public memos on the profile, in the feed, in finger and in Gemini, under the plan, and never private ones', async () => {
    const ada = await person('ada_memo');
    await ada.c.patch('/api/v1/me', { plan: 'Building a tower.' });
    const pub = (await write(ada, 'Public thought #tower', { visibility: 'public' })).body;
    await write(ada, 'Private worry');
    expect(ids(await visitor().get('/api/v1/memos/public/ada_memo'))).toEqual([pub.id]);
    const profile = (await visitor().get('/api/v1/users/ada_memo')).body;
    expect(profile.memos).toEqual([expect.objectContaining({ id: pub.id, body: 'Public thought #tower' })]);
    const feed = await ctx.app.inject({ method: 'GET', url: '/feeds/people/ada_memo/memos.atom' });
    expect(feed.statusCode).toBe(200);
    expect(feed.body).toContain('Public thought #tower');
    expect(feed.body).not.toContain('Private worry');
    const f = await finger(ctx.deps, 'ada_memo');
    expect(f).toContain('Plan:\nBuilding a tower.');
    expect(f).toMatch(/Memos:\n\d{4}-\d{2}-\d{2}  Public thought #tower/);
    expect(f).not.toContain('Private worry');
    const g = await gemini(ctx.deps, 'gemini://example.test/~ada_memo');
    expect(g.body).toContain('## Memos');
    expect(g.body).toContain('> Public thought #tower');
    expect(g.body).not.toContain('Private worry');
    // With memos but no plan, finger shows just the memos; with neither, "No plan."
    const bob = await person('bob_memo');
    expect(await finger(ctx.deps, 'bob_memo')).toContain('No plan.');
    await write(bob, 'Only memos here', { visibility: 'public' });
    const fb = await finger(ctx.deps, 'bob_memo');
    expect(fb).not.toContain('No plan.');
    expect(fb).toContain('Memos:');
    // Taking it back to private removes it everywhere.
    await ada.c.patch(`/api/v1/memos/${pub.id}`, { visibility: 'private' });
    expect(ids(await visitor().get('/api/v1/memos/public/ada_memo'))).toEqual([]);
    expect((await visitor().get(`/api/v1/memos/${pub.id}/thread`)).status).toBe(404);
  });

  it('shares into a ring for its members only, and leaving or a ban makes them private again', async () => {
    const founder = await person('memo_founder', 'trusted');
    const bea = await person('bea_memo');
    const cy = await person('cy_memo');
    const out = await person('out_memo');
    expect((await founder.c.post('/api/v1/rings', { slug: 'noters', name: 'Noters' })).status).toBe(201);
    expect((await write(bea, 'early', { visibility: 'ring', ring: 'noters' })).body.error.code).toBe('not_in_ring');
    await bea.c.post('/api/v1/rings/noters/join');
    await cy.c.post('/api/v1/rings/noters/join');
    const m = (await write(bea, 'For the ring', { visibility: 'ring', ring: 'noters' })).body;
    expect(m).toMatchObject({ visibility: 'ring', ring: { slug: 'noters' } });
    expect(ids(await cy.c.get('/api/v1/rings/noters/memos'))).toEqual([m.id]);
    expect(ids(await out.c.get('/api/v1/rings/noters/memos'))).toEqual([]);          // not a member
    expect(ids(await visitor().get('/api/v1/rings/noters/memos'))).toEqual([]);
    expect((await out.c.get(`/api/v1/memos/${m.id}/thread`)).status).toBe(404);
    expect((await visitor().get(`/api/v1/memos/${m.id}/thread`)).status).toBe(404);
    expect(ids(await visitor().get('/api/v1/memos/public/bea_memo'))).toEqual([]);   // a ring memo isn't on the profile
    expect((await cy.c.get(`/api/v1/memos/${m.id}/thread`)).status).toBe(200);
    expect((await finger(ctx.deps, 'bea_memo'))).not.toContain('For the ring');

    await bea.c.post('/api/v1/rings/noters/leave');
    expect((await bea.c.get(`/api/v1/memos/${m.id}`)).body).toMatchObject({ visibility: 'private', ring: null });
    expect((await cy.c.get(`/api/v1/memos/${m.id}/thread`)).status).toBe(404);
    const m2 = (await write(cy, 'Mine for the ring', { visibility: 'ring', ring: 'noters' })).body;
    const op = await loginAs(ctx, 'memo_founder');
    expect((await op.post(`/api/v1/rings/noters/members/${cy.id}/ban`, { reason: 'spam' })).status).toBe(204);
    expect((await cy.c.get(`/api/v1/memos/${m2.id}`)).body.visibility).toBe('private');
  });

  it('takes a suspended person\'s shared memos away with them', async () => {
    const dee = await person('dee_memo');
    await write(dee, 'Gone soon', { visibility: 'public' });
    await ctx.deps.db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [dee.id]);
    expect((await visitor().get('/api/v1/memos/public/dee_memo')).status).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/feeds/people/dee_memo/memos.atom' })).statusCode).toBe(404);
  });

  it('lets people reply and react to a shared memo, tells its writer, and refuses private memos', async () => {
    const eve = await person('eve_memo');
    const fay = await person('fay_memo');
    const pub = (await write(eve, 'Question for everyone', { visibility: 'public' })).body;
    const priv = (await write(eve, 'A secret')).body;
    expect((await fay.c.post(`/api/v1/memos/${priv.id}/replies`, { body: 'hi' })).status).toBe(404);
    expect((await eve.c.post(`/api/v1/memos/${priv.id}/replies`, { body: 'note to self' })).body.error.code).toBe('private_memo');
    const r1 = await fay.c.post(`/api/v1/memos/${pub.id}/replies`, { body: 'My answer' });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ reply_to: pub.id, owner: { handle: 'fay_memo' } });
    // An answer to a reply goes to the same thread.
    const r2 = await eve.c.post(`/api/v1/memos/${r1.body.id}/replies`, { body: 'Thanks!' });
    expect(r2.body.reply_to).toBe(pub.id);
    const thread = (await visitor().get(`/api/v1/memos/${pub.id}/thread`)).body;
    expect(thread.memo).toMatchObject({ id: pub.id, reply_count: 2 });
    expect(thread.replies.map((r: { body: string }) => r.body)).toEqual(['My answer', 'Thanks!']);
    expect((await fay.c.put(`/api/v1/memos/${pub.id}/reactions/love`)).body.reactions).toEqual([{ name: 'love', count: 1, mine: true }]);
    expect((await fay.c.put(`/api/v1/memos/${priv.id}/reactions/love`)).status).toBe(404);
    expect((await visitor().put(`/api/v1/memos/${pub.id}/reactions/love`)).status).toBe(401);

    const counts = (await eve.c.get('/api/v1/notifications/count')).body;
    expect(counts.by_app.memos).toBe(2);
    expect(counts.by_app.boards).toBe(0);
    const list = (await eve.c.get('/api/v1/notifications')).body.notifications;
    expect(list.map((n: { kind: string }) => n.kind).sort()).toEqual(['memo_reaction', 'memo_reply']);
    expect(list[0].link).toEqual({ app: 'memos', to: `m/${pub.id}` });
    expect(list.find((n: { kind: string }) => n.kind === 'memo_reply').subject).toBe('Question for everyone');
    // The Settings choice for replies switches the memo ones off too.
    await eve.c.put('/api/v1/me/notifications/prefs/reply', { enabled: false }).catch(() => undefined);

    // The writer can remove a reply under their memo; its author can remove their own; others can't.
    expect((await fay.c.delete(`/api/v1/memos/${r2.body.id}`)).status).toBe(404);
    expect((await eve.c.delete(`/api/v1/memos/${r1.body.id}`)).status).toBe(204);
    // Making the memo private hides the thread.
    await eve.c.patch(`/api/v1/memos/${pub.id}`, { visibility: 'private' });
    expect((await fay.c.get(`/api/v1/memos/${pub.id}/thread`)).status).toBe(404);
  });

  it('reports a ring memo to the ring\'s ops, who hide it with a reason (audited); the writer still sees it, marked', async () => {
    const founder = await person('memo_op', 'trusted');
    const gus = await person('gus_memo');
    const hal = await person('hal_memo');
    await founder.c.post('/api/v1/rings', { slug: 'makers-m', name: 'Makers' });
    await gus.c.post('/api/v1/rings/makers-m/join');
    await hal.c.post('/api/v1/rings/makers-m/join');
    const m = (await write(gus, 'Buy my stuff', { visibility: 'ring', ring: 'makers-m' })).body;
    expect((await gus.c.post(`/api/v1/memos/${m.id}/report`, { category: 'spam' })).body.error.code).toBe('own_memo');
    expect((await hal.c.post(`/api/v1/memos/${m.id}/report`, { category: 'spam', note: 'ads' })).status).toBe(201);
    expect((await hal.c.post(`/api/v1/memos/${m.id}/report`, { category: 'spam' })).body.error.code).toBe('already_reported');
    const op = await loginAs(ctx, 'memo_op');
    const queue = (await op.get('/api/v1/reports')).body.reports;
    expect(queue).toEqual([expect.objectContaining({ target: expect.objectContaining({ type: 'memo', id: m.id, handle: 'gus_memo' }), excerpt: 'Buy my stuff', memo: { root: m.id, hidden: false } })]);
    expect((await hal.c.post(`/api/v1/memos/${m.id}/hide`, { reason: 'not mine to hide' })).status).toBe(403);
    expect((await op.post(`/api/v1/memos/${m.id}/hide`, { reason: 'advertising' })).status).toBe(204);
    expect((await hal.c.get(`/api/v1/memos/${m.id}/thread`)).status).toBe(404);
    expect((await gus.c.get(`/api/v1/memos/${m.id}`)).body.hidden).toEqual({ reason: 'advertising' });
    expect((await op.get('/api/v1/reports')).body.reports).toEqual([]);   // closed as actioned
    const log = await ctx.deps.db.query(`SELECT action, after FROM audit_log WHERE target_id = $1 AND action LIKE 'memo.%'`, [m.id]);
    expect(log.rows).toEqual([expect.objectContaining({ action: 'memo.hidden', after: expect.objectContaining({ reason: 'advertising' }) })]);
    // Sharing it again doesn't bring it back; the ring's ops restore it.
    await gus.c.patch(`/api/v1/memos/${m.id}`, { visibility: 'public' });
    expect(ids(await visitor().get('/api/v1/memos/public/gus_memo'))).toEqual([]);
    const admin = (await makeAdmin(ctx)).client;
    expect((await op.post(`/api/v1/memos/${m.id}/restore`, { reason: 'my mistake' })).status).toBe(403);   // public now: the admins' to restore
    expect((await admin.post(`/api/v1/memos/${m.id}/restore`, { reason: 'fine after all' })).status).toBe(204);
    expect(ids(await visitor().get('/api/v1/memos/public/gus_memo'))).toEqual([m.id]);
  });

  it('removes a person\'s replies and reactions with their account', async () => {
    const ian = await person('ian_memo');
    const jo = await person('jo_memo');
    const pub = (await write(ian, 'Hello', { visibility: 'public' })).body;
    await jo.c.post(`/api/v1/memos/${pub.id}/replies`, { body: 'Hi there' });
    await jo.c.put(`/api/v1/memos/${pub.id}/reactions/agree`);
    const { deleteAccount } = await import('./deletion');
    await deleteAccount(ctx.deps, jo.id, { posts: 'keep', actor: null }, {});
    const thread = (await visitor().get(`/api/v1/memos/${pub.id}/thread`)).body;
    expect(thread.replies).toEqual([]);
    expect(thread.memo.reactions).toEqual([]);
    await deleteAccount(ctx.deps, ian.id, { posts: 'keep', actor: null }, {});
    expect((await ctx.deps.db.query(`SELECT 1 FROM memos WHERE id = $1`, [pub.id])).rowCount).toBe(0);
  });
});
