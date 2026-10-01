import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('the front page for visitors', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  it('shows threads from public boards only, a count of people online and no names, without signing in', async () => {
    const owner = await makeUser(ctx, { role: 'trusted' });
    const c = await loginAs(ctx, owner.handle);
    await c.post('/api/v1/boards', { slug: 'open', name: 'Open', visibility: 'public' });
    await c.post('/api/v1/boards', { slug: 'club', name: 'Club', visibility: 'members' });
    await c.post('/api/v1/boards', { slug: 'secret', name: 'Secret', visibility: 'private' });
    await c.post('/api/v1/boards/open/posts', { subject: 'Hello world', body: 'x'.repeat(400) });
    await c.post('/api/v1/boards/club/posts', { subject: 'Members only', body: 'Not for visitors.' });
    await c.post('/api/v1/boards/secret/posts', { subject: 'Private', body: 'Not for visitors either.' });

    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/landing' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age');
    const body = res.json();
    expect(body.threads.map((t: { subject: string }) => t.subject)).toEqual(['Hello world']);
    expect(body.threads[0].board).toEqual({ slug: 'open', name: 'Open' });
    expect(body.threads[0].excerpt.length).toBeLessThanOrEqual(161);
    expect(typeof body.online).toBe('number');
    expect(JSON.stringify(body)).not.toContain('Members only');
    expect(JSON.stringify(body)).not.toContain('email');
    expect(Object.keys(body).sort()).toEqual(['homepages', 'online', 'rings', 'threads']);
  });
});
