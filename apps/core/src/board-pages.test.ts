import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Page numbers for boards (docs/10, 17 2026-10-18): 201, 202, … in the order boards are made, kept for good.
describe.skipIf(!dbAvailable)('board page numbers', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let owner: ReturnType<typeof client>;
  let ownerId = '';

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.config.limits.trusted_board_quota = 50;
    const u = await makeUser(ctx, { role: 'trusted', handle: 'owner' });
    ownerId = u.id;
    owner = await loginAs(ctx, u.handle);
  });
  afterAll(async () => drop());

  const make = async (slug: string) => (await owner.post('/api/v1/boards', { slug, name: slug, visibility: 'public' })).body as { page: number | null };
  const pageOf = async (slug: string) => ((await owner.get(`/api/v1/boards/${slug}`)).body as { page: number | null }).page;

  it('numbers boards in the order they are made, starting at 201', async () => {
    expect((await make('first')).page).toBe(201);
    expect((await make('second')).page).toBe(202);
    const listed = (await owner.get('/api/v1/boards')).body.boards as { slug: string; page: number }[];
    expect(listed.find((b) => b.slug === 'first')!.page).toBe(201);
  });

  it('gives boards made at the same moment different numbers', async () => {
    const pages = await Promise.all(['c1', 'c2', 'c3', 'c4', 'c5'].map(async (s) => (await make(s)).page));
    expect(new Set(pages).size).toBe(5);
    expect(pages.every((p) => p !== null && p > 202 && p < 300)).toBe(true);
  });

  it('keeps a number when the board is archived', async () => {
    expect((await owner.patch('/api/v1/boards/first', { archived: true })).status).toBeLessThan(300);
    expect(await pageOf('first')).toBe(201);
  });

  it('carries on at 2100 once 201 to 299 are taken, and uses a freed number again', async () => {
    await ctx.deps.db.query(
      `INSERT INTO boards (id, slug, name, description, owner_id, visibility, page, archived_at)
       SELECT 'b_fill' || g, 'fill-' || g, 'Fill', '', $1, 'public', g, now() FROM generate_series(201, 299) g WHERE NOT EXISTS (SELECT 1 FROM boards WHERE page = g)`,
      [ownerId],
    );
    expect((await make('overflow')).page).toBe(2100);
    await ctx.deps.db.query(`DELETE FROM boards WHERE slug = 'fill-250'`);
    expect((await make('back-in')).page).toBe(250);
  });
});
