import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractMentions } from './text';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

describe('extractMentions', () => {
  it('finds handles, once each, ignoring case', () => {
    expect(extractMentions('hi @Bob and @bob, also @al_ice-2!')).toEqual(['bob', 'al_ice-2']);
  });
  it('ignores email addresses, addresses in the middle of words and paths', () => {
    expect(extractMentions('mail me at a@bob.example or foo@carol, see /u/@dave, @@erin')).toEqual([]);
  });
  it('ignores things that cannot be handles', () => {
    expect(extractMentions('@1abc @a @-x')).toEqual([]);
  });
  it('stops at 10 people', () => {
    const body = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(' ');
    expect(extractMentions(body)).toHaveLength(10);
  });
});

describe.skipIf(!dbAvailable)('notifications', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type C = ReturnType<typeof client>;
  const people: Record<string, { id: string; handle: string; c: C }> = {};

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ctx.deps.config.limits.trusted_board_quota = 50;
    for (const [name, role] of [['owner', 'trusted'], ['alice', 'user'], ['bob', 'user'], ['carol', 'user']] as const) {
      const u = await makeUser(ctx, { role, handle: name });
      people[name] = { id: u.id, handle: u.handle, c: await loginAs(ctx, u.handle) };
    }
    await people.owner!.c.post('/api/v1/boards', { slug: 'lounge', name: 'Lounge', visibility: 'public' });
  });
  afterAll(async () => drop());

  const p = (n: string) => people[n]!;
  const post = async (who: string, body: string, opts: { subject?: string; reply_to?: string; board?: string } = {}) => {
    const r = await p(who).c.post(`/api/v1/boards/${opts.board ?? 'lounge'}/posts`, { subject: opts.subject ?? (opts.reply_to ? undefined : 'Topic'), body, reply_to: opts.reply_to });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string };
  };
  // The unread ones: most tests clear the inbox as they go, and read notifications stay in the list.
  const inbox = async (who: string) => {
    const b = (await p(who).c.get('/api/v1/notifications')).body as { notifications: { id: string; kind: string; read: boolean; actor: { handle: string }; link: { app: string; to: string } }[]; unread: number; next: string | null };
    return { ...b, notifications: b.notifications.filter((n) => !n.read) };
  };
  const clear = (who: string) => p(who).c.post('/api/v1/notifications/read', { all: true });

  it('tells someone their post got a reply, and not the person replying to themselves', async () => {
    const t = await post('alice', 'my thread');
    await post('alice', 'talking to myself', { reply_to: t.id });
    expect((await inbox('alice')).notifications).toHaveLength(0);
    await post('bob', 'a reply', { reply_to: t.id });
    const n = await inbox('alice');
    expect(n.unread).toBe(1);
    expect(n.notifications[0]).toMatchObject({ kind: 'reply', actor: { handle: 'bob' }, link: { app: 'boards', to: `lounge/t/${t.id}` } });
    await clear('alice');
  });

  it('tells people who are mentioned, and sends one notification when a person is both replied to and mentioned', async () => {
    const t = await post('alice', 'thread two');
    await post('bob', 'hello @carol and @alice', { reply_to: t.id });
    expect((await inbox('carol')).notifications.map((n) => n.kind)).toEqual(['mention']);
    expect((await inbox('alice')).notifications.map((n) => n.kind)).toEqual(['reply']);
    await clear('alice'); await clear('carol');
  });

  it('does not mention yourself, a guest, an unknown handle or a person who cannot read the board', async () => {
    await p('owner').c.post('/api/v1/boards', { slug: 'vault', name: 'Vault', visibility: 'private' });
    const guest = await makeUser(ctx, { role: 'guest', verified: false, handle: 'gina' });
    await post('owner', 'psst @carol @gina @nobody @owner', { board: 'vault' });
    expect((await inbox('carol')).notifications).toHaveLength(0);
    const g = await loginAs(ctx, guest.handle);
    expect(((await g.get('/api/v1/notifications')).body as { notifications: unknown[] }).notifications).toHaveLength(0);
    expect((await inbox('owner')).notifications).toHaveLength(0);
    // A member of the private board is told.
    await p('owner').c.post('/api/v1/boards/vault/members', { handle: 'carol' });
    await post('owner', 'now you are in @carol', { board: 'vault' });
    expect((await inbox('carol')).notifications.map((n) => n.kind)).toEqual(['mention']);
    await clear('carol');
  });

  it('tells watchers about new threads, and only about threads', async () => {
    await p('carol').c.put('/api/v1/boards/lounge/watch');
    const t = await post('alice', 'a brand new thread');
    expect((await inbox('carol')).notifications.map((n) => n.kind)).toEqual(['watch']);
    await clear('carol');
    await post('bob', 'just a reply', { reply_to: t.id });
    expect((await inbox('carol')).notifications).toHaveLength(0);
    await p('carol').c.delete('/api/v1/boards/lounge/watch');
    await post('alice', 'another thread');
    expect((await inbox('carol')).notifications).toHaveLength(0);
  });

  it('counts unread, marks some or all as read, and keeps other people’s notifications private', async () => {
    await clear('alice'); // earlier tests left replies unread
    const t = await post('alice', 'count me');
    await post('bob', 'one', { reply_to: t.id });
    await post('carol', 'two', { reply_to: t.id });
    const n = await inbox('alice');
    expect(n.unread).toBe(2);
    expect((await p('alice').c.get('/api/v1/notifications/count')).body).toEqual({ unread: 2 });
    expect((await p('bob').c.post('/api/v1/notifications/read', { ids: [n.notifications[0]!.id] })).status).toBe(404);
    expect((await p('alice').c.post('/api/v1/notifications/read', { ids: [n.notifications[0]!.id] })).status).toBe(204);
    expect((await inbox('alice')).unread).toBe(1);
    await clear('alice');
    const after = await inbox('alice');
    expect(after.unread).toBe(0);
    const all = (await p('alice').c.get('/api/v1/notifications')).body.notifications as { read: boolean }[];
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every((x) => x.read)).toBe(true); // read ones stay in the list
  });

  it('pages through older notifications', async () => {
    const t = await post('owner', 'paging');
    for (let i = 0; i < 3; i++) await post('bob', `reply ${i}`, { reply_to: t.id });
    const first = (await p('owner').c.get('/api/v1/notifications?limit=2')).body;
    expect(first.notifications).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = (await p('owner').c.get(`/api/v1/notifications?limit=2&before=${first.next}`)).body;
    expect(second.notifications.length).toBeGreaterThan(0);
    expect(second.notifications.map((n: { id: string }) => n.id)).not.toContain(first.notifications[0].id);
  });

  it('drops a notification when the post it is about is deleted', async () => {
    const t = await post('carol', 'mine');
    const r = await post('bob', 'oops, wrong thread', { reply_to: t.id });
    expect((await inbox('carol')).unread).toBeGreaterThan(0);
    const before = (await inbox('carol')).unread;
    await p('bob').c.delete(`/api/v1/posts/${r.id}`);
    expect((await inbox('carol')).unread).toBe(before - 1);
  });

  it('needs a login', async () => {
    const v = client(ctx.app);
    expect((await v.get('/api/v1/notifications')).status).toBe(401);
    expect((await v.get('/api/v1/notifications/count')).status).toBe(401);
    expect((await v.post('/api/v1/notifications/read', { all: true })).status).toBe(401);
  });
});
