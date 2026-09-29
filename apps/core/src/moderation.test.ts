import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('moderation', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type C = ReturnType<typeof client>;
  type P = { id: string; handle: string; c: C };
  let owner: P, alice: P, bob: P, carol: P, dana: P;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const visitor = () => client(ctx.app);

  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => {
    const u = await makeUser(ctx, { role, handle });
    return { id: u.id, handle, c: await loginAs(ctx, handle) };
  };
  const board = async (slug: string, visibility = 'public', by = owner) => {
    const r = await by.c.post('/api/v1/boards', { slug, name: slug, visibility });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string; slug: string };
  };
  const thread = async (slug: string, by: P, subject = 'A thread', body = 'the first post') => {
    const r = await by.c.post(`/api/v1/boards/${slug}/posts`, { subject, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { id: string };
  };
  const reply = async (slug: string, by: P, to: string, body = 'a reply') => {
    const r = await by.c.post(`/api/v1/boards/${slug}/posts`, { body, reply_to: to });
    return r;
  };
  const act = (by: C, action: string, post_id: string, extra: Record<string, unknown> = {}) =>
    by.post('/api/v1/mod-actions', { action, post_id, reason: 'because the rules say so', ...extra });
  const view = async (by: C, slug: string, id: string) => (await by.get(`/api/v1/boards/${slug}/threads/${id}`)).body;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ctx.deps.config.limits.trusted_board_quota = 50;
    owner = await person('owner', 'trusted');
    alice = await person('alice');
    bob = await person('bob');
    carol = await person('carol');
    dana = await person('dana', 'trusted');
    admin = await makeAdmin(ctx);
    await board('main');
  });
  afterAll(async () => drop());

  describe('who may act', () => {
    it('lets the owner and admins act, and refuses everyone else', async () => {
      const t = await thread('main', alice);
      expect((await act(bob.c, 'hide', t.id)).status).toBe(403);
      expect((await act(visitor(), 'hide', t.id)).status).toBe(401);
      expect((await act(owner.c, 'hide', t.id)).status).toBe(201);
      expect((await act(admin.client, 'unhide', t.id)).status).toBe(201);
    });
    it('needs a reason and refuses a bad action', async () => {
      const t = await thread('main', alice);
      expect((await owner.c.post('/api/v1/mod-actions', { action: 'hide', post_id: t.id })).status).toBe(400);
      expect((await owner.c.post('/api/v1/mod-actions', { action: 'hide', post_id: t.id, reason: 'no' })).status).toBe(400);
      expect((await owner.c.post('/api/v1/mod-actions', { action: 'ban', post_id: t.id, reason: 'because' })).status).toBe(400);
      expect((await owner.c.post('/api/v1/mod-actions', { action: 'move', post_id: t.id, reason: 'because' })).status).toBe(400);
    });
    it('does not let the op of one board act on another, or reveal a private board’s posts to an outsider', async () => {
      await board('elsewhere', 'public', dana);
      await board('closed', 'private');
      const t = await thread('closed', owner);
      expect((await act(dana.c, 'hide', t.id)).status).toBe(404); // cannot even see it
      const m = await thread('main', alice);
      expect((await act(dana.c, 'hide', m.id)).status).toBe(403); // can see it, does not run it
    });
  });

  describe('hide and unhide', () => {
    it('hides a reply from readers, keeps it for moderators, and keeps the reply count right', async () => {
      const t = await thread('main', alice, 'Hide test');
      const r = (await reply('main', bob, t.id, 'rude words')).body;
      expect((await act(owner.c, 'hide', r.id)).status).toBe(201);
      const pub = await view(visitor(), 'main', t.id);
      expect(pub.posts[1]).toMatchObject({ id: r.id, state: 'hidden', body: null, subject: '' });
      expect((await view(owner.c, 'main', t.id)).posts[1]).toMatchObject({ state: 'hidden', body: 'rude words' });
      const listed = (await visitor().get('/api/v1/boards/main/threads')).body.threads.find((x: { id: string }) => x.id === t.id);
      expect(listed.reply_count).toBe(0);
      expect((await act(owner.c, 'hide', r.id)).body.error.code).toBe('no_change');
      await act(owner.c, 'unhide', r.id);
      expect((await view(visitor(), 'main', t.id)).posts[1]).toMatchObject({ state: 'ok', body: 'rude words' });
      expect((await visitor().get('/api/v1/boards/main/threads')).body.threads.find((x: { id: string }) => x.id === t.id).reply_count).toBe(1);
    });
    it('hides a whole thread from lists, from direct links and from search', async () => {
      const t = await thread('main', alice, 'Searchable oddity', 'flibbertigibbet marker');
      expect((await visitor().get('/api/v1/search?q=flibbertigibbet')).body.hits).toHaveLength(1);
      await act(owner.c, 'hide', t.id);
      expect((await visitor().get('/api/v1/search?q=flibbertigibbet')).body.hits).toHaveLength(0);
      expect((await visitor().get(`/api/v1/boards/main/threads/${t.id}`)).status).toBe(404);
      expect((await visitor().get('/api/v1/boards/main/threads')).body.threads.map((x: { id: string }) => x.id)).not.toContain(t.id);
      expect((await owner.c.get('/api/v1/boards/main/threads')).body.threads.map((x: { id: string }) => x.id)).toContain(t.id);
      await act(owner.c, 'unhide', t.id);
      expect((await visitor().get(`/api/v1/boards/main/threads/${t.id}`)).status).toBe(200);
    });
  });

  describe('remove', () => {
    it('erases the text for good, says a moderator did it, and cannot be undone', async () => {
      const t = await thread('main', alice, 'To remove', 'secret text');
      const a = await act(owner.c, 'remove', t.id);
      expect(a.status).toBe(201);
      expect((await view(visitor(), 'main', t.id)).posts[0]).toMatchObject({ state: 'removed', body: null, author: null });
      expect(first(await db.query(`SELECT subject, body, deleted_by FROM posts WHERE id = $1`, [t.id]))).toEqual({ subject: '', body: '', deleted_by: 'moderator' });
      expect((await owner.c.post(`/api/v1/mod-actions/${a.body.id}/undo`)).body.error.code).toBe('not_undoable');
      expect((await act(owner.c, 'remove', t.id)).body.error.code).toBe('gone');
      expect((await alice.c.delete(`/api/v1/posts/${t.id}`)).body.error.code).toBe('no_change');
    });
  });

  describe('lock', () => {
    it('stops replies from everyone but moderators, and only applies to whole threads', async () => {
      const t = await thread('main', alice, 'Lock me');
      const r = (await reply('main', bob, t.id)).body;
      expect((await act(owner.c, 'lock', r.id)).body.error.code).toBe('not_a_thread');
      const a = await act(owner.c, 'lock', t.id);
      expect(a.status).toBe(201);
      expect((await view(visitor(), 'main', t.id)).locked).toBe(true);
      expect((await visitor().get('/api/v1/boards/main/threads')).body.threads.find((x: { id: string }) => x.id === t.id).locked).toBe(true);
      const blocked = await reply('main', carol, t.id);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('locked');
      expect((await reply('main', carol, r.id)).body.error.code).toBe('locked'); // a reply inside the thread too
      expect((await reply('main', owner, t.id, 'the owner may still reply')).status).toBe(201);
      expect((await act(owner.c, 'lock', t.id)).body.error.code).toBe('no_change');
      expect((await owner.c.post(`/api/v1/mod-actions/${a.body.id}/undo`)).status).toBe(201);
      expect((await reply('main', carol, t.id)).status).toBe(201);
    });
  });

  describe('move', () => {
    it('moves a thread with its replies, notifications and reports, and can move it back', async () => {
      await board('dest');
      const t = await thread('main', alice, 'Wrong place');
      const r = (await reply('main', bob, t.id, 'hello @carol')).body;
      const rep = await carol.c.post('/api/v1/reports', { post_id: r.id, category: 'other', note: '' });
      expect(rep.status).toBe(201);
      const m = await act(owner.c, 'move', t.id, { to_board: 'dest' });
      expect(m.status).toBe(201);
      expect((await visitor().get(`/api/v1/boards/main/threads/${t.id}`)).status).toBe(404);
      const moved = await view(visitor(), 'dest', t.id);
      expect(moved.posts).toHaveLength(2);
      expect(moved.posts.every((p: { board_id: string }) => p.board_id === moved.board.id)).toBe(true);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM notifications n JOIN boards b ON b.id = n.board_id WHERE b.slug = 'dest'`)).n).toBeGreaterThan(0);
      expect(first(await db.query(`SELECT b.slug FROM reports r JOIN boards b ON b.id = r.scope_id WHERE r.id = $1`, [rep.body.id])).slug).toBe('dest');
      expect((await act(owner.c, 'move', t.id, { to_board: 'dest' })).body.error.code).toBe('no_change');
      expect((await owner.c.post(`/api/v1/mod-actions/${m.body.id}/undo`)).status).toBe(201);
      expect((await visitor().get(`/api/v1/boards/main/threads/${t.id}`)).status).toBe(200);
    });
    it('needs you to run the board it goes to, and refuses archived and unseen boards', async () => {
      await board('theirs', 'public', dana);
      await board('hush', 'private', dana);
      const t = await thread('main', alice);
      expect((await act(owner.c, 'move', t.id, { to_board: 'theirs' })).status).toBe(403);
      expect((await act(owner.c, 'move', t.id, { to_board: 'hush' })).status).toBe(404);
      expect((await act(owner.c, 'move', t.id, { to_board: 'nowhere' })).status).toBe(404);
      await board('mothballed');
      await owner.c.patch('/api/v1/boards/mothballed', { archived: true });
      expect((await act(owner.c, 'move', t.id, { to_board: 'mothballed' })).body.error.code).toBe('archived');
      expect((await act(admin.client, 'move', t.id, { to_board: 'theirs' })).status).toBe(201); // an admin runs every board
    });
  });

  describe('the mod log', () => {
    it('lists what was done, publicly, without any post text, and marks what was undone', async () => {
      await board('logged');
      const t = await thread('logged', alice, 'Logged', 'do not leak this text');
      const h = await act(owner.c, 'hide', t.id);
      await owner.c.post(`/api/v1/mod-actions/${h.body.id}/undo`);
      const log = (await visitor().get('/api/v1/modlog?board=logged')).body;
      expect(log.entries.map((e: { action: string }) => e.action)).toEqual(['unhide', 'hide']);
      expect(log.entries[1]).toMatchObject({ actor: { handle: 'owner' }, post_author: 'alice', reason: 'because the rules say so', undone: true, undoable: false });
      expect(JSON.stringify(log)).not.toContain('do not leak this text');
    });
    it('asks for a board, hides a private board’s log from outsiders, and honours the site setting', async () => {
      expect((await visitor().get('/api/v1/modlog')).body.error.code).toBe('board_required');
      expect((await admin.client.get('/api/v1/modlog')).status).toBe(200);
      expect((await visitor().get('/api/v1/modlog?board=closed')).status).toBe(404);
      ctx.deps.config.moderation.public_modlog = false;
      try {
        expect((await visitor().get('/api/v1/modlog?board=logged')).status).toBe(403);
        expect((await owner.c.get('/api/v1/modlog?board=logged')).status).toBe(200);
      } finally { ctx.deps.config.moderation.public_modlog = true; }
    });
    it('writes every action to the audit log too', async () => {
      const n = first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'mod.%'`)).n;
      const m = first(await db.query(`SELECT count(*)::int AS n FROM mod_actions`)).n;
      expect(n).toBe(m);
    });
  });

  describe('reports', () => {
    it('lets a confirmed user report a post they can see, once, but not their own', async () => {
      const t = await thread('main', alice, 'Report me');
      expect((await carol.c.post('/api/v1/reports', { post_id: t.id, category: 'spam', note: 'ads' })).status).toBe(201);
      expect((await carol.c.post('/api/v1/reports', { post_id: t.id, category: 'abuse' })).body.error.code).toBe('already_reported');
      expect((await alice.c.post('/api/v1/reports', { post_id: t.id, category: 'spam' })).body.error.code).toBe('own_post');
      expect((await visitor().post('/api/v1/reports', { post_id: t.id, category: 'spam' })).status).toBe(401);
      const guest = await makeUser(ctx, { role: 'guest', verified: false });
      expect((await (await loginAs(ctx, guest.handle)).post('/api/v1/reports', { post_id: t.id, category: 'spam' })).status).toBe(403);
      expect((await carol.c.post('/api/v1/reports', { post_id: t.id, category: 'nonsense' })).status).toBe(400);
      const hidden = first(await db.query(`SELECT id FROM posts WHERE subject = 'A thread' AND board_id = (SELECT id FROM boards WHERE slug = 'closed') LIMIT 1`)).id;
      expect((await carol.c.post('/api/v1/reports', { post_id: hidden, category: 'spam' })).status).toBe(404);
    });
    it('routes a report to that board’s moderators only, and to admins', async () => {
      const t = await thread('main', alice, 'Route me');
      await bob.c.post('/api/v1/reports', { post_id: t.id, category: 'abuse', note: 'so rude' });
      const forOwner = (await owner.c.get('/api/v1/reports')).body.reports;
      const mine = forOwner.find((r: { post: { id: string } }) => r.post.id === t.id);
      expect(mine).toMatchObject({ status: 'open', category: 'abuse', note: 'so rude', reporter: { handle: 'bob' }, board: { slug: 'main' }, post: { subject: 'Route me', author: 'alice' } });
      // dana runs other boards, so she has a queue of her own, but this report is not in it
      expect((await dana.c.get('/api/v1/reports')).body.reports.map((r: { id: string }) => r.id)).not.toContain(mine.id);
      expect((await carol.c.get('/api/v1/reports')).status).toBe(403); // runs nothing
      expect((await admin.client.get('/api/v1/reports')).body.reports.map((r: { id: string }) => r.id)).toContain(mine.id);
      expect((await bob.c.get('/api/v1/reports')).status).toBe(403);
      expect((await visitor().get('/api/v1/reports')).status).toBe(401);
    });
    it('marks a report as waiting too long after a day, and counts other reports about the same post', async () => {
      const t = await thread('main', alice, 'Old news');
      await bob.c.post('/api/v1/reports', { post_id: t.id, category: 'spam' });
      await carol.c.post('/api/v1/reports', { post_id: t.id, category: 'spam' });
      const find = async () => (await owner.c.get('/api/v1/reports')).body.reports.find((r: { post: { id: string }; reporter: { handle: string } }) => r.post.id === t.id && r.reporter.handle === 'bob');
      expect(await find()).toMatchObject({ escalated: false, other_open: 1 });
      ctx.clock.advance(25 * 3600);
      expect((await find()).escalated).toBe(true);
    });
    it('is dealt with by dismissing or by acting, by the people it belongs to', async () => {
      const t = await thread('main', alice, 'Dismiss me');
      const rp = (await bob.c.post('/api/v1/reports', { post_id: t.id, category: 'other' })).body;
      expect((await carol.c.post(`/api/v1/reports/${rp.id}/resolve`, { resolution: 'dismissed' })).status).toBe(404);
      expect((await dana.c.post(`/api/v1/reports/${rp.id}/resolve`, { resolution: 'dismissed' })).status).toBe(404);
      expect((await owner.c.post(`/api/v1/reports/${rp.id}/resolve`, { resolution: 'dismissed', note: 'looks fine' })).status).toBe(204);
      expect((await owner.c.post(`/api/v1/reports/${rp.id}/resolve`, { resolution: 'dismissed' })).body.error.code).toBe('no_change');
      const done = (await owner.c.get('/api/v1/reports?status=dismissed')).body.reports.find((r: { id: string }) => r.id === rp.id);
      expect(done).toMatchObject({ status: 'dismissed', resolution_note: 'looks fine' });
      expect((await bob.c.post('/api/v1/reports', { post_id: t.id, category: 'other' })).status).toBe(201); // may report again once it is closed
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'report.resolved' AND after->>'report' = $1`, [rp.id])).n).toBe(1);
    });
    it('is closed automatically when the post is hidden or removed', async () => {
      const t = await thread('main', alice, 'Auto close');
      const rp = (await bob.c.post('/api/v1/reports', { post_id: t.id, category: 'spam' })).body;
      await act(owner.c, 'hide', t.id);
      const r = (await owner.c.get('/api/v1/reports?status=actioned')).body.reports.find((x: { id: string }) => x.id === rp.id);
      expect(r).toMatchObject({ status: 'actioned' });
      expect(r.resolution_note).toMatch(/Hidden by a moderator/);
    });
  });

  describe('board ops', () => {
    let b: { id: string };
    beforeAll(async () => { b = await board('opsboard'); });

    it('lets the owner appoint an op, who can then act on that board only, and cannot appoint more', async () => {
      const t = await thread('opsboard', alice);
      expect((await act(bob.c, 'hide', t.id)).status).toBe(403);
      expect((await owner.c.post('/api/v1/boards/opsboard/ops', { handle: 'bob' })).status).toBe(204);
      const me = (await bob.c.get('/api/v1/me')).body.user;
      expect(me.ops).toEqual([`board:${b.id}`]);
      expect(me.role_rev).toBeGreaterThan(0);
      expect((await act(bob.c, 'hide', t.id)).status).toBe(201);
      expect((await act(bob.c, 'hide', (await thread('main', alice)).id)).status).toBe(403);
      expect((await bob.c.post('/api/v1/boards/opsboard/ops', { handle: 'carol' })).status).toBe(403);
      expect((await bob.c.get('/api/v1/boards/opsboard')).body.can_moderate).toBe(true);
      expect((await bob.c.get('/api/v1/reports')).status).toBe(200);
    });
    it('lists the ops, refuses duplicates, guests and unknown handles, and audits the change', async () => {
      const list = (await owner.c.get('/api/v1/boards/opsboard/ops')).body.ops;
      expect(list.map((o: { user: { handle: string } }) => o.user.handle)).toEqual(['bob']);
      expect((await carol.c.get('/api/v1/boards/opsboard/ops')).status).toBe(403);
      expect((await owner.c.post('/api/v1/boards/opsboard/ops', { handle: 'bob' })).body.error.code).toBe('already_op');
      expect((await owner.c.post('/api/v1/boards/opsboard/ops', { handle: 'nobody' })).status).toBe(404);
      const g = await makeUser(ctx, { role: 'guest', verified: false, handle: 'gary' });
      expect((await owner.c.post('/api/v1/boards/opsboard/ops', { handle: g.handle })).status).toBe(404);
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'user.ops_changed' AND actor_id = $1`, [owner.id])).n).toBe(1);
    });
    it('lets the owner remove an op, or the op step down, and takes their powers away at once', async () => {
      const opId = (await owner.c.get('/api/v1/boards/opsboard/ops')).body.ops[0].id;
      expect((await carol.c.delete(`/api/v1/boards/opsboard/ops/${opId}`)).status).toBe(403);
      expect((await bob.c.delete(`/api/v1/boards/opsboard/ops/${opId}`)).status).toBe(204);
      const t = await thread('opsboard', alice);
      expect((await act(bob.c, 'hide', t.id)).status).toBe(403);
      expect((await bob.c.get('/api/v1/me')).body.user.ops).toEqual([]);
      await owner.c.post('/api/v1/boards/opsboard/ops', { handle: 'bob' });
      const again = (await owner.c.get('/api/v1/boards/opsboard/ops')).body.ops[0].id;
      expect((await owner.c.delete(`/api/v1/boards/opsboard/ops/${again}`)).status).toBe(204);
    });
  });
});
