import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('editing, pinning and reacting', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  async function setup() {
    const owner = await makeUser(ctx, { role: 'trusted' });
    const o = await loginAs(ctx, owner.handle);
    const slug = `b${Math.random().toString(36).slice(2, 8)}`;
    await o.post('/api/v1/boards', { slug, name: 'Extras', visibility: 'public' });
    const th = (await o.post(`/api/v1/boards/${slug}/posts`, { subject: 'First thread', body: 'Original words.' })).body;
    return { owner, o, slug, th };
  }

  it('lets the author edit within 24 hours, keeps the old text, and marks the post edited', async () => {
    const { o, slug, th } = await setup();
    const res = await o.patch(`/api/v1/posts/${th.id}`, { subject: 'First thread, fixed', body: 'Better words.' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ subject: 'First thread, fixed', body: 'Better words.' });
    expect(res.body.edited_at).not.toBeNull();
    const revs = (await o.get(`/api/v1/posts/${th.id}/revisions`)).body.revisions;
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ subject: 'First thread', body: 'Original words.', reason: null });
    const shown = (await o.get(`/api/v1/boards/${slug}/threads/${th.id}`)).body.posts[0];
    expect(shown.edited_at).not.toBeNull();
  });

  it('refuses an edit after 24 hours (to an ordinary author), from a stranger, and one that changes nothing', async () => {
    const { slug } = await setup();
    const writer = await makeUser(ctx);
    const w = await loginAs(ctx, writer.handle);
    const th = (await w.post(`/api/v1/boards/${slug}/posts`, { subject: 'First thread', body: 'Original words.' })).body;
    const stranger = await makeUser(ctx);
    const s = await loginAs(ctx, stranger.handle);
    expect((await s.patch(`/api/v1/posts/${th.id}`, { body: 'Hijack' })).body.error.code).toBe('forbidden');
    expect((await w.patch(`/api/v1/posts/${th.id}`, { body: 'Original words.', subject: 'First thread' })).body.error.code).toBe('no_change');
    await ctx.deps.db.query(`UPDATE posts SET posted_at = now() - interval '25 hours' WHERE id = $1`, [th.id]);
    const late = await w.patch(`/api/v1/posts/${th.id}`, { body: 'Too late.' });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe('edit_window');
  });

  it('lets a moderator edit someone else’s post at any time, with a reason that is kept and audited', async () => {
    const { o, slug } = await setup(); // o owns the board, so moderates it
    const writer = await makeUser(ctx);
    const w = await loginAs(ctx, writer.handle);
    const post = (await w.post(`/api/v1/boards/${slug}/posts`, { subject: 'Writer thread', body: 'Contact me at 555-0100.' })).body;
    await ctx.deps.db.query(`UPDATE posts SET posted_at = now() - interval '3 days' WHERE id = $1`, [post.id]);
    expect((await o.patch(`/api/v1/posts/${post.id}`, { body: 'Contact me at [removed].' })).body.error.code).toBe('reason_required');
    const ok = await o.patch(`/api/v1/posts/${post.id}`, { body: 'Contact me at [removed].', reason: 'Phone number' });
    expect(ok.status).toBe(200);
    const revs = (await w.get(`/api/v1/posts/${post.id}/revisions`)).body.revisions;
    expect(revs[0]).toMatchObject({ body: 'Contact me at 555-0100.', reason: 'Phone number' });
    const audit = await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action = 'post.edited_by_moderator' AND target_id = $1`, [post.id]);
    expect(audit.rowCount).toBe(1);
  });

  it('erases the history when the post is deleted', async () => {
    const { o, th } = await setup();
    await o.patch(`/api/v1/posts/${th.id}`, { body: 'Second version.' });
    expect((await ctx.deps.db.query(`SELECT 1 FROM post_revisions WHERE post_id = $1`, [th.id])).rowCount).toBe(1);
    expect((await o.delete(`/api/v1/posts/${th.id}`)).status).toBe(204);
    expect((await ctx.deps.db.query(`SELECT 1 FROM post_revisions WHERE post_id = $1`, [th.id])).rowCount).toBe(0);
    expect((await o.get(`/api/v1/posts/${th.id}/revisions`)).status).toBe(404);
  });

  it('pins up to three threads to the top of the first page, for the board’s people only', async () => {
    const { o, slug, th } = await setup();
    const ids = [th.id];
    for (let i = 0; i < 3; i++) ids.push((await o.post(`/api/v1/boards/${slug}/posts`, { subject: `Thread ${i}`, body: 'x' })).body.id);
    const reader = await makeUser(ctx);
    const r = await loginAs(ctx, reader.handle);
    expect((await r.put(`/api/v1/boards/${slug}/threads/${ids[0]}/pin`)).status).toBe(403);
    for (const id of ids.slice(0, 3)) expect((await o.put(`/api/v1/boards/${slug}/threads/${id}/pin`)).status).toBe(204);
    expect((await o.put(`/api/v1/boards/${slug}/threads/${ids[3]}/pin`)).body.error.code).toBe('too_many_pins');
    const list = (await r.get(`/api/v1/boards/${slug}/threads`)).body.threads as { id: string; pinned: boolean }[];
    expect(list.slice(0, 3).every((t) => t.pinned)).toBe(true);
    expect(list[3]).toMatchObject({ id: ids[3], pinned: false });
    expect((await o.delete(`/api/v1/boards/${slug}/threads/${ids[0]}/pin`)).status).toBe(204);
    expect((await o.delete(`/api/v1/boards/${slug}/threads/${ids[0]}/pin`)).body.error.code).toBe('no_change');
  });

  it('counts reactions in a fixed order, one of each kind per person, and refuses them on posts that are not showing', async () => {
    const { o, slug, th } = await setup();
    const a = await makeUser(ctx);
    const b = await makeUser(ctx);
    const ac = await loginAs(ctx, a.handle);
    const bc = await loginAs(ctx, b.handle);
    expect((await ac.put(`/api/v1/posts/${th.id}/reactions/thanks`)).status).toBe(200);
    await ac.put(`/api/v1/posts/${th.id}/reactions/thanks`); // twice is still once
    await bc.put(`/api/v1/posts/${th.id}/reactions/thanks`);
    const r = await bc.put(`/api/v1/posts/${th.id}/reactions/agree`);
    expect(r.body.reactions).toEqual([{ name: 'agree', count: 1, mine: true }, { name: 'thanks', count: 2, mine: true }]);
    expect((await ac.put(`/api/v1/posts/${th.id}/reactions/nope`)).status).toBe(400);
    const seen = (await ac.get(`/api/v1/boards/${slug}/threads/${th.id}`)).body.posts[0].reactions;
    expect(seen).toEqual([{ name: 'agree', count: 1, mine: false }, { name: 'thanks', count: 2, mine: true }]);
    await bc.delete(`/api/v1/posts/${th.id}/reactions/agree`);
    expect((await bc.get(`/api/v1/boards/${slug}/threads/${th.id}`)).body.posts[0].reactions).toEqual([{ name: 'thanks', count: 2, mine: true }]);
    await o.delete(`/api/v1/posts/${th.id}`);
    expect((await ac.put(`/api/v1/posts/${th.id}/reactions/love`)).status).toBe(409);
    const guest = await makeUser(ctx, { verified: false, role: 'guest' });
    const g = await loginAs(ctx, guest.handle);
    expect((await g.put(`/api/v1/posts/${th.id}/reactions/love`)).status).toBe(403);
  });

  it('suggests handles by prefix for confirmed people only', async () => {
    const lin = await makeUser(ctx, { handle: 'linnea' });
    await makeUser(ctx, { handle: 'lindsey' });
    await makeUser(ctx, { handle: 'bob_x' });
    const c = await loginAs(ctx, lin.handle);
    const r = (await c.get('/api/v1/mentions?prefix=lin')).body.people.map((p: { handle: string }) => p.handle);
    expect(r).toEqual(['lindsey', 'linnea']);
    expect((await c.get('/api/v1/mentions?prefix=%25')).body.people).toEqual([]); // a wildcard is not a wildcard
    const guest = await makeUser(ctx, { verified: false, role: 'guest' });
    const g = await loginAs(ctx, guest.handle);
    expect((await g.get('/api/v1/mentions?prefix=lin')).status).toBe(403);
  });
});
