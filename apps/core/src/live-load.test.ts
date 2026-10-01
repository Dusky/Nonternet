import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
// @ts-expect-error a plain script shared with scripts/load-test.mjs
import { holdStreams } from '../../../scripts/sse-load.mjs';
import { liveCount } from './live';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser, ORIGIN } from './test/harness';

// 100 live streams on one core process (M9 verification): all of them open, all of them hear a change on a board they
// can read, and every one is let go when its tab closes. Five streams a person is the limit, so this takes twenty people.
describe.skipIf(!dbAvailable)('a hundred open live streams', { timeout: 60_000 }, () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); await ctx.app.listen({ port: 0, host: '127.0.0.1' }); });
  afterAll(async () => { await ctx.app.close(); await drop(); });

  it('opens, delivers a hint to every stream, and cleans up', async () => {
    const base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
    const sids: string[] = [];
    for (let i = 0; i < 20; i++) sids.push((await loginAs(ctx, (await makeUser(ctx, { role: i === 0 ? 'trusted' : 'user' })).handle)).sid!);
    const poster = await loginAs(ctx, (await makeUser(ctx, { role: 'trusted' })).handle);
    await poster.post('/api/v1/boards', { slug: 'loadb', name: 'Load', visibility: 'public' });

    const abort = new AbortController();
    const heapBefore = process.memoryUsage().heapUsed;
    const live = await holdStreams({ base, origin: ORIGIN, sids, count: 100, signal: abort.signal });
    const st = await live.ready(20_000);
    expect(st.failed).toBe(0);
    expect(st.opened).toBe(100);
    expect(liveCount()).toBe(100);

    const before = st.hints;
    expect((await poster.post('/api/v1/boards/loadb/posts', { subject: 'Hello streams', body: 'Everyone should hear this.' })).status).toBe(201);
    const end = Date.now() + 5000;
    while (st.hints - before < 100 && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    expect(st.hints - before).toBeGreaterThanOrEqual(100); // a hint per stream, none content
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(150 * 1024 * 1024);

    abort.abort();
    await live.done;
    for (let i = 0; i < 50 && liveCount() > 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(liveCount()).toBe(0);
  });
});
