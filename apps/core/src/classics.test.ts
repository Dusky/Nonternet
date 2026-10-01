import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';
import { processNext } from './exports/service';
import { deleteAccount } from './deletion';

describe.skipIf(!dbAvailable)('BBS classics', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());
  const person = async (role: 'user' | 'trusted' = 'user') => { const u = await makeUser(ctx, { role }); return { ...u, c: await loginAs(ctx, u.handle) }; };

  it('puts up a oneliner, one an hour, and hides one an admin removes', async () => {
    const a = await person(); const b = await person();
    expect((await a.c.post('/api/v1/oneliners', { body: 'hello wall' })).status).toBe(201);
    expect((await a.c.post('/api/v1/oneliners', { body: 'and again' })).body.error.code).toBe('too_soon');
    expect((await b.c.post('/api/v1/oneliners', { body: 'x'.repeat(61) })).status).toBe(400);
    expect((await b.c.post('/api/v1/oneliners', { body: 'two\nlines' })).status).toBe(400);
    const wall = (await b.c.get('/api/v1/oneliners')).body.oneliners;
    expect(wall[0]).toMatchObject({ body: 'hello wall', author: { handle: a.handle }, mine: false });
    // After an hour (the database's clock) another line is fine.
    await ctx.deps.db.query(`UPDATE oneliners SET created_at = now() - interval '2 hours' WHERE author_id = $1`, [a.id]);
    const second = await a.c.post('/api/v1/oneliners', { body: 'rude line' });
    expect(second.status).toBe(201);
    const adm = await makeAdmin(ctx);
    expect((await adm.client.post(`/api/v1/admin/oneliners/${second.body.id}/hide`, {})).status).toBe(400); // a reason is needed
    expect((await adm.client.post(`/api/v1/admin/oneliners/${second.body.id}/hide`, { reason: 'Abusive' })).status).toBe(204);
    expect((await b.c.get('/api/v1/oneliners')).body.oneliners.map((o: { body: string }) => o.body)).not.toContain('rude line');
    expect((await b.c.post(`/api/v1/admin/oneliners/${second.body.id}/hide`, { reason: 'Abusive' })).status).toBe(403);
    const logged = await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action = 'oneliner.hidden' AND target_id = $1`, [a.id]);
    expect(logged.rowCount).toBe(1);
  });

  it('hides a blocked person’s lines from the person who blocked them', async () => {
    const a = await person(); const b = await person();
    await a.c.post('/api/v1/oneliners', { body: 'from a blocked person' });
    await b.c.post('/api/v1/me/blocks', { handle: a.handle });
    expect((await b.c.get('/api/v1/oneliners')).body.oneliners.some((o: { body: string }) => o.body === 'from a blocked person')).toBe(false);
  });

  it('numbers bulletins, marks them read in order, and lets only admins write them', async () => {
    const u = await person();
    const adm = await makeAdmin(ctx);
    expect((await u.c.post('/api/v1/admin/bulletins', { title: 'Nope', body: 'nope' })).status).toBe(403);
    const one = (await adm.client.post('/api/v1/admin/bulletins', { title: 'Welcome', body: 'First notice.' })).body;
    const two = (await adm.client.post('/api/v1/admin/bulletins', { title: 'Maintenance', body: 'Sunday.' })).body;
    expect([one.number, two.number]).toEqual([one.number, one.number + 1]);
    expect((await u.c.get('/api/v1/bulletins')).body.unread).toBe(2);
    expect((await u.c.get(`/api/v1/bulletins/${two.number}`)).body).toMatchObject({ title: 'Maintenance', body: 'Sunday.' });
    const after = (await u.c.get('/api/v1/bulletins')).body;
    expect(after.unread).toBe(0); // reading the newest counts the older ones as seen
    expect((await adm.client.patch(`/api/v1/admin/bulletins/${two.number}`, { title: 'Maintenance (moved)', body: 'Monday.' })).status).toBe(204);
    expect((await adm.client.post(`/api/v1/admin/bulletins/${one.number}/hide`, { reason: 'Out of date' })).status).toBe(204);
    expect((await u.c.get(`/api/v1/bulletins/${one.number}`)).status).toBe(404);
    expect((await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action IN ('bulletin.created','bulletin.edited','bulletin.hidden')`)).rowCount).toBeGreaterThanOrEqual(4);
  });

  it('runs a poll: trusted people ask, everyone votes once, results show after voting', async () => {
    const asker = await person('trusted'); const voter = await person(); const other = await person();
    expect((await voter.c.post('/api/v1/polls', { question: 'Best colour?', options: ['Red', 'Blue'] })).status).toBe(403);
    expect((await asker.c.post('/api/v1/polls', { question: 'Best colour?', options: ['Red', 'Red'] })).status).toBe(400);
    expect((await asker.c.post('/api/v1/polls', { question: 'Best colour?', options: ['Only one'] })).status).toBe(400);
    const made = (await asker.c.post('/api/v1/polls', { question: 'Best colour?', options: ['Red', 'Blue', 'Green'], closes_in_days: 7 })).body;
    const before = (await voter.c.get(`/api/v1/polls/${made.id}`)).body;
    expect(before).toMatchObject({ voted: false, can_see_results: false, total: null });
    expect(before.options.every((o: { votes: number | null }) => o.votes === null)).toBe(true);
    const blue = before.options.find((o: { label: string }) => o.label === 'Blue').id;
    const after = (await voter.c.post(`/api/v1/polls/${made.id}/vote`, { option_id: blue })).body;
    expect(after).toMatchObject({ voted: true, my_vote: blue, can_see_results: true, total: 1 });
    expect(after.options.find((o: { id: string }) => o.id === blue).votes).toBe(1);
    expect((await voter.c.post(`/api/v1/polls/${made.id}/vote`, { option_id: blue })).body.error.code).toBe('already_voted');
    expect((await other.c.post(`/api/v1/polls/${made.id}/vote`, { option_id: 'po_00000000000000000000000000' })).body.error.code).toBe('bad_option');
    // Once closed, anyone sees the result and nobody can vote.
    await ctx.deps.db.query(`UPDATE polls SET closes_at = now() - interval '1 minute' WHERE id = $1`, [made.id]);
    expect((await other.c.get(`/api/v1/polls/${made.id}`)).body).toMatchObject({ closed: true, can_see_results: true, total: 1 });
    expect((await other.c.post(`/api/v1/polls/${made.id}/vote`, { option_id: blue })).body.error.code).toBe('closed');
    const adm = await makeAdmin(ctx);
    expect((await adm.client.post(`/api/v1/admin/polls/${made.id}/hide`, { reason: 'Spam' })).status).toBe(204);
    expect((await other.c.get(`/api/v1/polls/${made.id}`)).status).toBe(404);
  });

  it('refuses people who have not confirmed their email, and visitors', async () => {
    const guest = await makeUser(ctx, { verified: false, role: 'guest' });
    const g = await loginAs(ctx, guest.handle);
    expect((await g.get('/api/v1/oneliners')).status).toBe(403);
    expect((await g.get('/api/v1/polls')).status).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/bulletins' })).statusCode).toBe(401);
  });

  it('exports your lines and votes, and erasing the account removes them', async () => {
    const asker = await person('trusted');
    const u = await person();
    await u.c.post('/api/v1/oneliners', { body: 'my own line' });
    const poll = (await asker.c.post('/api/v1/polls', { question: 'Tabs or spaces?', options: ['Tabs', 'Spaces'] })).body;
    const opt = (await u.c.get(`/api/v1/polls/${poll.id}`)).body.options[1].id;
    await u.c.post(`/api/v1/polls/${poll.id}/vote`, { option_id: opt });
    const r = await u.c.post('/api/v1/me/export', { password: TEST_PASSWORD });
    await processNext(ctx.deps);
    const dl = await ctx.app.inject({ method: 'GET', url: `/api/v1/me/exports/${r.body.id}/download`, headers: { cookie: `sid=${u.c.sid}` } });
    const out = JSON.parse(strFromU8(unzipSync(new Uint8Array(dl.rawPayload))['classics.json']!));
    expect(out.oneliners[0].text).toBe('my own line');
    expect(out.poll_votes).toEqual([expect.objectContaining({ poll: 'Tabs or spaces?', choice: 'Spaces' })]);
    await deleteAccount(ctx.deps, u.id, { posts: 'keep', actor: null }, {});
    const left = await ctx.deps.db.query(`SELECT (SELECT count(*) FROM oneliners WHERE author_id = $1) AS lines, (SELECT count(*) FROM poll_votes WHERE user_id = $1) AS votes`, [u.id]);
    expect(left.rows[0]).toMatchObject({ lines: '0', votes: '0' });
  });
});
