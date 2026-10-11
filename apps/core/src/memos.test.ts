import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractTags } from '@app/shared';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser, TEST_PASSWORD } from './test/harness';
import { importMemos } from './memos';
import { processNext } from './exports/service';
import { deleteAccount } from './deletion';

describe('tags in a memo\'s text', () => {
  it('finds #tags, once each, lowercased, up to five', () => {
    expect(extractTags('Dinner #Food and #food again, then #pasta-night! #a #ok')).toEqual(['food', 'pasta-night', 'ok']);
    expect(extractTags('#one #two #three #four #five #six')).toEqual(['one', 'two', 'three', 'four', 'five']);
  });
  it('ignores a # inside an address, code, an entity or a word', () => {
    expect(extractTags('see https://example.com/page#section and issue#42 and &#39;')).toEqual([]);
    expect(extractTags('use `#notatag` or\n```\n#alsonot\n```\nbut #real')).toEqual(['real']);
    expect(extractTags('#x too short, #-bad, and #' + 'y'.repeat(21))).toEqual([]);
  });
});

describe.skipIf(!dbAvailable)('memos', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());
  const person = async () => { const u = await makeUser(ctx); return { u, c: await loginAs(ctx, u.handle) }; };
  const write = (c: Awaited<ReturnType<typeof loginAs>>, body: string, extra: Record<string, unknown> = {}) => c.post('/api/v1/memos', { body, ...extra });

  it('writes a private memo with its tags, edits it, and shows "edited" only after a real change', async () => {
    const { c } = await person();
    const r = await write(c, 'Buy lentils #shopping #food');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ body: 'Buy lentils #shopping #food', tags: ['food', 'shopping'], visibility: 'private', pinned: false, edited_at: null, ring: null });
    const same = await c.patch(`/api/v1/memos/${r.body.id}`, { body: 'Buy lentils #shopping #food' });
    expect(same.body.edited_at).toBeNull();
    const edited = await c.patch(`/api/v1/memos/${r.body.id}`, { body: 'Buy red lentils #food #soup' });
    expect(edited.body).toMatchObject({ tags: ['food', 'soup'] });
    expect(edited.body.edited_at).not.toBeNull();
    expect((await c.get('/api/v1/memos/tags')).body.tags).toEqual([{ tag: 'food', count: 1 }, { tag: 'soup', count: 1 }]);
  });

  it('refuses an empty memo, a long one, sharing before it exists, and guests', async () => {
    const { c } = await person();
    expect((await write(c, '   ')).status).toBe(400);
    expect((await write(c, 'x'.repeat(2001))).status).toBe(400);
    expect((await write(c, 'hello', { visibility: 'ring' })).status).toBe(400); // which ring?
    const guest = await loginAs(ctx, (await makeUser(ctx, { role: 'guest', verified: false })).handle);
    expect((await write(guest, 'hi')).status).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/memos' })).statusCode).toBe(401);
  });

  it('lists pinned memos first on the first page, then newest first in pages; searches; filters by tag', async () => {
    const { c } = await person();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await write(c, `Note number ${i} ${i % 2 ? '#odd' : '#even'}`)).body.id);
    const soup = (await write(c, 'Lentil soup recipe')).body.id;
    await c.patch(`/api/v1/memos/${ids[0]}`, { pinned: true });
    const p1 = (await c.get('/api/v1/memos?limit=3')).body;
    expect(p1.memos.map((m: { id: string }) => m.id)).toEqual([ids[0], soup, ids[5], ids[4]]);   // the pin, then three newest
    expect(p1.total).toBe(7);
    const p2 = (await c.get(`/api/v1/memos?limit=3&before=${encodeURIComponent(p1.next)}`)).body;
    expect(p2.memos.map((m: { id: string }) => m.id)).toEqual([ids[3], ids[2], ids[1]]);
    expect(p2.next).toBeNull();
    expect((await c.get('/api/v1/memos?q=lentil')).body.memos.map((m: { id: string }) => m.id)).toEqual([soup]);
    expect((await c.get('/api/v1/memos?tag=odd')).body.total).toBe(3);
    expect((await c.get('/api/v1/memos?pinned=true')).body.memos.map((m: { id: string }) => m.id)).toEqual([ids[0]]);
    const hub = (await c.get('/api/v1/memos/hub')).body;
    expect(hub.recent).toHaveLength(5);
    expect(hub.total).toBe(7);
  });

  it('keeps everyone\'s memos to themselves', async () => {
    const a = await person();
    const b = await person();
    const m = (await write(a.c, 'only mine')).body;
    expect((await b.c.get(`/api/v1/memos/${m.id}`)).status).toBe(404);
    expect((await b.c.patch(`/api/v1/memos/${m.id}`, { body: 'mine now' })).status).toBe(404);
    expect((await b.c.delete(`/api/v1/memos/${m.id}`)).status).toBe(404);
    expect((await b.c.get('/api/v1/memos')).body.total).toBe(0);
    expect((await a.c.delete(`/api/v1/memos/${m.id}`)).status).toBe(204);
    expect((await a.c.get(`/api/v1/memos/${m.id}`)).status).toBe(404);
  });

  it('is in the export, comes back private with its dates on import, and goes with the account', async () => {
    const { u, c } = await person();
    const m = (await write(c, 'Kept note #keep', { pinned: true })).body;
    expect((await c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await ctx.deps.db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [u.id])).rows[0]!;
    const files = unzipSync(new Uint8Array(readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`))));
    const list = JSON.parse(strFromU8(files['memos.json']!));
    expect(list).toEqual([expect.objectContaining({ body: 'Kept note #keep', pinned: true, visibility: 'private', ring: null, reply_to: null, tags: ['keep'] })]);

    const other = await makeUser(ctx);
    const viewer = { userId: other.id, handle: other.handle, role: 'user' } as Parameters<typeof importMemos>[1];
    const r = await importMemos(ctx.deps, viewer, [...list, { ...list[0], body: 'Was shared', visibility: 'public' }, { body: 'a reply', reply_to: 'mm_X' }, { nothing: true }]);
    expect(r).toEqual({ restored: 2, codes: ['made_private', 'memo_reply', 'invalid'] });
    expect(await importMemos(ctx.deps, viewer, list)).toEqual({ restored: 0, codes: ['exists'] });
    const rows = (await ctx.deps.db.query(`SELECT body, visibility, created_at FROM memos WHERE user_id = $1 ORDER BY body`, [other.id])).rows;
    expect(rows.map((r2) => r2.visibility)).toEqual(['private', 'private']);
    expect(rows[0]!.created_at.toISOString()).toBe(list[0].created_at);

    await deleteAccount(ctx.deps, u.id, { posts: 'keep', actor: null }, {});
    expect((await ctx.deps.db.query(`SELECT 1 FROM memos WHERE id = $1`, [m.id])).rowCount).toBe(0);
    expect((await ctx.deps.db.query(`SELECT 1 FROM memo_tags WHERE memo_id = $1`, [m.id])).rowCount).toBe(0);
  });
});
