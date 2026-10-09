import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Polls inside a thread (docs/23, E3b).
describe.skipIf(!dbAvailable)('thread polls', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type C = ReturnType<typeof client>;
  const who: Record<string, { id: string; handle: string; c: C }> = {};
  const w = (n: string) => who[n]!;
  beforeAll(async () => {
    const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db);
    ctx.deps.config.limits.trusted_board_quota = 50;
    for (const [name, role] of [['owner', 'trusted'], ['alice', 'user'], ['bob', 'user'], ['outsider', 'user']] as const) {
      const u = await makeUser(ctx, { role, handle: name });
      who[name] = { id: u.id, handle: u.handle, c: await loginAs(ctx, u.handle) };
    }
    await w('owner').c.post('/api/v1/boards', { slug: 'open', name: 'Open', visibility: 'public' });
    await w('owner').c.post('/api/v1/boards', { slug: 'closed', name: 'Closed', visibility: 'private' });
    await w('owner').c.post('/api/v1/boards/closed/members', { handle: 'alice' });
  });
  afterAll(async () => drop());

  const poll = { question: 'Where to meet?', options: ['Park', 'Cafe', 'Online'], closes_in_days: 3 };
  const start = async (n: string, slug: string, extra: object = {}) => (await w(n).c.post(`/api/v1/boards/${slug}/posts`, { subject: 'Meetup', body: 'vote please', poll, ...extra })).body as { id: string };

  it('starts with a thread, shows on the thread and the list, and takes one vote each with the tally hidden until then', async () => {
    const t = await start('alice', 'open');
    const th = (await w('bob').c.get(`/api/v1/boards/open/threads/${t.id}`)).body;
    expect(th.poll_id).toMatch(/^pl_/);
    expect((await w('bob').c.get('/api/v1/boards/open/threads')).body.threads.find((x: { id: string }) => x.id === t.id).has_poll).toBe(true);
    const p = (await w('bob').c.get(`/api/v1/polls/${th.poll_id}`)).body;
    expect(p).toMatchObject({ question: 'Where to meet?', voted: false, total: null, can_close: false });
    expect(p.options.every((o: { votes: number | null }) => o.votes === null)).toBe(true);
    const v = await w('bob').c.post(`/api/v1/polls/${th.poll_id}/vote`, { option_id: p.options[1].id });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ voted: true, total: 1 });
    expect((await w('bob').c.post(`/api/v1/polls/${th.poll_id}/vote`, { option_id: p.options[0].id })).status).toBe(409);
    // The voting booth (the site-wide list) doesn't show it.
    expect((await w('bob').c.get('/api/v1/polls')).body.polls.map((x: { id: string }) => x.id)).not.toContain(th.poll_id);
  });

  it('takes up to ten choices, one poll per thread, and none on a reply', async () => {
    const ten = await w('alice').c.post('/api/v1/boards/open/posts', { subject: 'Ten', body: 'x', poll: { question: 'Pick one', options: Array.from({ length: 10 }, (_, i) => `Choice ${i}`) } });
    expect(ten.status).toBe(201);
    const eleven = await w('alice').c.post('/api/v1/boards/open/posts', { subject: 'Eleven', body: 'x', poll: { question: 'Pick one', options: Array.from({ length: 11 }, (_, i) => `Choice ${i}`) } });
    expect(eleven.status).toBe(400);
    const t = await start('alice', 'open');
    expect((await w('bob').c.post('/api/v1/boards/open/posts', { body: 'reply', reply_to: t.id, poll })).status).toBe(400);
  });

  it('is closed early by its author or a moderator (audited), and then shows the tally', async () => {
    const t = await start('alice', 'open');
    const id = (await w('bob').c.get(`/api/v1/boards/open/threads/${t.id}`)).body.poll_id as string;
    expect((await w('alice').c.get(`/api/v1/polls/${id}`)).body.can_close).toBe(true);
    expect((await w('bob').c.post(`/api/v1/polls/${id}/close`)).status).toBe(403);
    expect((await w('owner').c.post(`/api/v1/polls/${id}/close`)).status).toBe(204);
    expect((await w('owner').c.post(`/api/v1/polls/${id}/close`)).status).toBe(409);
    const log = await ctx.deps.db.query(`SELECT actor_id FROM audit_log WHERE action = 'poll.closed' AND target_id = $1`, [id]);
    expect(log.rows).toHaveLength(1);
    const after = (await w('bob').c.get(`/api/v1/polls/${id}`)).body;
    expect(after).toMatchObject({ closed: true, can_see_results: true });
    expect((await w('bob').c.post(`/api/v1/polls/${id}/vote`, { option_id: after.options[0].id })).status).toBe(409);
    // The author closing their own is not a moderator action.
    const t2 = await start('alice', 'open');
    const id2 = (await w('bob').c.get(`/api/v1/boards/open/threads/${t2.id}`)).body.poll_id as string;
    expect((await w('alice').c.post(`/api/v1/polls/${id2}/close`)).status).toBe(204);
    expect((await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action = 'poll.closed' AND target_id = $1`, [id2])).rowCount).toBe(0);
  });

  it('stays inside a private board', async () => {
    const t = await start('alice', 'closed');
    const id = (await w('alice').c.get(`/api/v1/boards/closed/threads/${t.id}`)).body.poll_id as string;
    expect((await w('outsider').c.get(`/api/v1/polls/${id}`)).status).toBe(404);
    const opt = (await w('alice').c.get(`/api/v1/polls/${id}`)).body.options[0].id as string;
    expect((await w('outsider').c.post(`/api/v1/polls/${id}/vote`, { option_id: opt })).status).toBe(404);
    expect((await w('alice').c.post(`/api/v1/polls/${id}/vote`, { option_id: opt })).status).toBe(200);
  });
});
