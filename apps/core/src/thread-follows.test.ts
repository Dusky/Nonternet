import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Boards depth (docs/23, E3a): following a thread, sorting and filtering the list, and a board's rules.
describe.skipIf(!dbAvailable)('thread follows, thread list order and board rules', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type C = ReturnType<typeof client>;
  const who: Record<string, { id: string; handle: string; c: C }> = {};
  const w = (n: string) => who[n]!;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.config.limits.trusted_board_quota = 50;
    for (const [name, role] of [['owner', 'trusted'], ['alice', 'user'], ['bob', 'user'], ['carol', 'user']] as const) {
      const u = await makeUser(ctx, { role, handle: name });
      who[name] = { id: u.id, handle: u.handle, c: await loginAs(ctx, u.handle) };
    }
    await w('owner').c.post('/api/v1/boards', { slug: 'lounge', name: 'Lounge', visibility: 'public' });
    const post = async (n: string, body: object) => (await w(n).c.post('/api/v1/boards/lounge/posts', body)).body as { id: string };
    ids.quiet = (await post('alice', { subject: 'Quiet one', body: 'nobody answers' })).id;
    ids.busy = (await post('alice', { subject: 'Busy one', body: 'many answers' })).id;
    ids.mid = (await post('alice', { subject: 'Middle one', body: 'one answer' })).id;
    await post('bob', { body: 'a', reply_to: ids.busy });
    await post('bob', { body: 'b', reply_to: ids.busy });
    await post('bob', { body: 'c', reply_to: ids.mid });
  });
  afterAll(async () => drop());

  const order = async (who_: string, q: string) =>
    ((await w(who_).c.get(`/api/v1/boards/lounge/threads?${q}`)).body.threads as { subject: string }[]).map((t) => t.subject);
  const unread = async (n: string) => (await w(n).c.get('/api/v1/notifications')).body.notifications.filter((x: { read: boolean }) => !x.read) as { kind: string; link: { to: string } }[];

  it('follows a thread you write in, and tells you about its replies', async () => {
    // Alice started all three threads, so she follows them: Bob's replies reached her as replies.
    expect((await unread('alice')).filter((n) => n.kind === 'reply').length).toBe(3);
    const t = (await w('alice').c.get(`/api/v1/boards/lounge/threads/${ids.busy}`)).body;
    expect(t.following).toBe(true);
    expect((await w('bob').c.get(`/api/v1/boards/lounge/threads/${ids.quiet}`)).body.following).toBe(false);
  });

  it('follow and unfollow change who hears about replies', async () => {
    expect((await w('carol').c.put(`/api/v1/boards/lounge/threads/${ids.quiet}/follow`)).status).toBe(204);
    await w('bob').c.post('/api/v1/boards/lounge/posts', { body: 'finally', reply_to: ids.quiet });
    expect((await unread('carol')).map((n) => n.kind)).toEqual(['reply']);
    await w('carol').c.post('/api/v1/notifications/read', { all: true });
    expect((await w('carol').c.delete(`/api/v1/boards/lounge/threads/${ids.quiet}/follow`)).status).toBe(204);
    await w('bob').c.post('/api/v1/boards/lounge/posts', { body: 'more', reply_to: ids.quiet });
    expect(await unread('carol')).toHaveLength(0);
    // Not a real thread, or one you cannot see.
    expect((await w('carol').c.put(`/api/v1/boards/lounge/threads/p_${'0'.repeat(26)}/follow`)).status).toBe(404);
  });

  it('sorts by activity, newest or most replies, and filters unanswered or unread', async () => {
    // Replies were last added to "Quiet one" (it got two), so it is the most recent activity; "Busy one" has two replies too.
    expect((await order('carol', 'sort=newest'))).toEqual(['Middle one', 'Busy one', 'Quiet one']);
    expect((await order('carol', 'sort=replies'))[0]).toMatch(/Busy one|Quiet one/);
    expect((await order('carol', 'filter=unanswered'))).toEqual([]);
    const fresh = (await w('alice').c.post('/api/v1/boards/lounge/posts', { subject: 'Nobody home', body: 'x' })).body.id as string;
    expect((await order('carol', 'filter=unanswered'))).toEqual(['Nobody home']);
    expect((await order('carol', 'filter=unread')).length).toBeGreaterThan(0);
    expect((await w('carol').c.get('/api/v1/boards/lounge/threads?sort=nonsense')).status).toBe(400);
    expect(fresh).toBeTruthy();
  });

  it('pages through "most replies" with an offset', async () => {
    const first = (await w('carol').c.get('/api/v1/boards/lounge/threads?sort=replies&limit=2')).body;
    expect(first.threads).toHaveLength(2);
    expect(first.next).toBe(2);
    const second = (await w('carol').c.get(`/api/v1/boards/lounge/threads?sort=replies&limit=2&before=${first.next}`)).body;
    expect(second.threads.length).toBeGreaterThan(0);
    expect(new Set([...first.threads, ...second.threads].map((t: { id: string }) => t.id)).size).toBe(first.threads.length + second.threads.length);
  });

  it('keeps rules on the board for owners to change, and audits it', async () => {
    expect((await w('alice').c.patch('/api/v1/boards/lounge', { rules: 'Be kind.' })).status).toBe(403);
    const r = await w('owner').c.patch('/api/v1/boards/lounge', { rules: 'Be kind.\nNo spam.' });
    expect(r.status).toBe(200);
    expect(r.body.rules).toBe('Be kind.\nNo spam.');
    expect((await w('carol').c.get('/api/v1/boards/lounge')).body.rules).toBe('Be kind.\nNo spam.');
    expect((await w('owner').c.patch('/api/v1/boards/lounge', { rules: 'x'.repeat(2001) })).status).toBe(400);
    const logged = await ctx.deps.db.query(`SELECT after FROM audit_log WHERE action = 'board.updated' ORDER BY id DESC LIMIT 1`);
    expect(logged.rows[0]!.after.rules).toBe('Be kind.\nNo spam.');
  });
});
