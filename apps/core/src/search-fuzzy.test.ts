import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Search that forgives part of a word, a typo or a missing accent (docs/14; research pick 2026-10-18).
describe.skipIf(!dbAvailable)('forgiving search', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let c: Awaited<ReturnType<typeof loginAs>>;
  beforeAll(async () => {
    const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db);
    const u = await makeUser(ctx, { role: 'trusted' });
    c = await loginAs(ctx, u.handle);
  });
  afterAll(async () => drop());

  it('memos: part of a word, a typo and no accent all find it; two letters only use full words', async () => {
    expect((await c.post('/api/v1/memos', { body: 'Lunch at the Café Lumière with Postgres people' })).status).toBe(201);
    const find = async (q: string) => (await c.get(`/api/v1/memos?q=${encodeURIComponent(q)}`)).body.memos.length;
    expect(await find('postg')).toBe(1);     // part of a word
    expect(await find('cafe')).toBe(1);      // no accent
    expect(await find('lumire')).toBe(1);    // a letter missing
    expect(await find('zebra')).toBe(0);
    expect(await find('po')).toBe(0);        // too short to guess at
  });

  it('wiki titles, thread subjects and bookmark addresses', async () => {
    expect((await c.put('/api/v1/wiki/site/pages/getting-started', { title: 'Getting Started', body: 'Read this first.', base_revision: 0 })).status).toBe(200);
    const wiki = (await c.get('/api/v1/wiki/site/search?q=startd')).body;
    expect((wiki.hits ?? wiki).map((h: { slug: string }) => h.slug)).toContain('getting-started');

    expect((await c.post('/api/v1/boards', { slug: 'synths', name: 'Synths', visibility: 'public' })).status).toBe(201);
    expect((await c.post('/api/v1/boards/synths/posts', { subject: 'Modular synthesizers on a budget', body: 'Cheap patch cables.' })).status).toBe(201);
    const hits = (await c.get('/api/v1/search?q=synthesiz')).body.hits;
    expect(hits.map((h: { post: { subject: string } }) => h.post.subject)).toContain('Modular synthesizers on a budget');

    const saved = await c.post('/api/v1/bookmarks', { url: 'https://example.invalid/pottery-wheels', title: 'Throwing pots' });
    expect(saved.status).toBeLessThan(300);
    const marks = (await c.get('/api/v1/bookmarks?q=potery')).body.bookmarks;
    expect(marks.map((b: { title: string }) => b.title)).toContain('Throwing pots');
  });
});
