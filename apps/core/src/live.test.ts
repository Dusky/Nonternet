import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveAll, liveCount, liveTo, subscribeLive, type LiveEvent } from './live';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

describe('the live hub', () => {
  it('sends to the people named, to everyone, or to confirmed people only', () => {
    const got: Record<string, LiveEvent[]> = { a: [], b: [], guest: [] };
    const offs = [
      subscribeLive({ userId: 'a', confirmed: true, send: (e) => got.a!.push(e), close: () => undefined }),
      subscribeLive({ userId: 'b', confirmed: true, send: (e) => got.b!.push(e), close: () => undefined }),
      subscribeLive({ userId: 'guest', confirmed: false, send: (e) => got.guest!.push(e), close: () => undefined }),
    ];
    liveTo(['a'], { type: 'mail' });
    liveAll({ type: 'announcements' });
    liveAll({ type: 'board', slug: 'club', thread: 'p_1' }, { confirmedOnly: true });
    expect(got.a!.map((e) => e.type)).toEqual(['mail', 'announcements', 'board']);
    expect(got.b!.map((e) => e.type)).toEqual(['announcements', 'board']);
    expect(got.guest!.map((e) => e.type)).toEqual(['announcements']);
    offs.forEach((off) => off());
    expect(liveCount()).toBe(0);
    liveAll({ type: 'announcements' }); // nobody listening: nothing happens
  });
});

describe.skipIf(!dbAvailable)('GET /api/v1/events', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  it('refuses a visitor', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/events' });
    expect(res.statusCode).toBe(401);
  });

  it('streams a hint to a signed-in person when someone replies to them, and not to a stranger', async () => {
    const ada = await makeUser(ctx, { role: 'trusted' });
    const lin = await makeUser(ctx);
    const bob = await makeUser(ctx);
    const a = await loginAs(ctx, ada.handle);
    const l = await loginAs(ctx, lin.handle);
    await a.post('/api/v1/boards', { slug: 'live', name: 'Live', visibility: 'public' });
    const th = (await a.post('/api/v1/boards/live/posts', { subject: 'Hello', body: 'First.' })).body;

    const hints: Record<string, LiveEvent[]> = { ada: [], bob: [] };
    const off = [
      subscribeLive({ userId: (await a.get('/api/v1/me')).body.user.id, confirmed: true, send: (e) => hints.ada!.push(e), close: () => undefined }),
      subscribeLive({ userId: bob.id, confirmed: true, send: (e) => hints.bob!.push(e), close: () => undefined }),
    ];
    await l.post('/api/v1/boards/live/posts', { body: 'Hi Ada', reply_to: th.id });
    expect(hints.ada!.map((e) => e.type).sort()).toEqual(['board', 'notifications']);
    expect(hints.bob!.map((e) => e.type)).toEqual(['board']); // a public board's hint is for everyone
    off.forEach((o) => o());
  });

  it('a private board names itself only to its members', async () => {
    const owner = await makeUser(ctx, { role: 'trusted' });
    const outsider = await makeUser(ctx);
    const o = await loginAs(ctx, owner.handle);
    await o.post('/api/v1/boards', { slug: 'hush', name: 'Hush', visibility: 'private' });
    const ownerId = (await o.get('/api/v1/me')).body.user.id as string;
    const seen: LiveEvent[][] = [[], []];
    const off = [
      subscribeLive({ userId: ownerId, confirmed: true, send: (e) => seen[0]!.push(e), close: () => undefined }),
      subscribeLive({ userId: outsider.id, confirmed: true, send: (e) => seen[1]!.push(e), close: () => undefined }),
    ];
    await o.post('/api/v1/boards/hush/posts', { subject: 'Secret', body: 'Not for you.' });
    expect(seen[0]!.map((e) => e.type)).toEqual(['board']);
    expect(seen[1]).toEqual([]);
    off.forEach((x) => x());
  });
});
