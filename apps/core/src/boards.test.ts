import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, first, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';
import { previewPost, normalizeBody, replySubject, wrapForTerminal } from './text';

describe('post text', () => {
  it('cleans control and direction characters, tabs and line endings', () => {
    const rogue = String.fromCharCode(0x202e, 0x200b, 0x1b, 0);
    expect(normalizeBody(`hello${rogue}\r\nworld\t!  \r\n\r\n`)).toBe('hello\nworld    !');
  });
  it('refuses empty and oversize bodies', () => {
    expect(() => normalizeBody('  \n ')).toThrow(/Write something/);
    expect(() => normalizeBody('x'.repeat(20001))).toThrow(/20,000/);
  });
  it('wraps at 79 columns, keeps blank lines and breaks a word that is too long', () => {
    const lines = wrapForTerminal(`${'word '.repeat(30).trim()}\n\n${'x'.repeat(200)}`);
    expect(lines.every((l) => [...l].length <= 79)).toBe(true);
    expect(lines).toContain('');
    expect(lines.join('').replace(/\s/g, '')).toContain('x'.repeat(200));
  });
  it('flags characters a classic terminal cannot show, and only those', () => {
    expect(previewPost('café ✓ 日本').warnings[0]).toMatch(/✓ 日 本/);
    expect(previewPost('plain text, café and ñ').warnings).toEqual([]);
  });
  it('builds a reply subject without stacking Re:', () => {
    expect(replySubject('hello')).toBe('Re: hello');
    expect(replySubject('Re: RE: hello')).toBe('Re: hello');
    expect([...replySubject('x'.repeat(71))].length).toBe(71);
  });
});

describe.skipIf(!dbAvailable)('boards', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let owner: Awaited<ReturnType<typeof makeUser>>;
  let alice: Awaited<ReturnType<typeof makeUser>>;
  let bob: Awaited<ReturnType<typeof makeUser>>;
  let ownerC: ReturnType<typeof client>;
  let aliceC: ReturnType<typeof client>;
  let bobC: ReturnType<typeof client>;
  const visitor = () => client(ctx.app);

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ctx.deps.config.limits.trusted_board_quota = 50; // the quota test lowers it; the rest just make boards
    owner = await makeUser(ctx, { role: 'trusted' });
    alice = await makeUser(ctx);
    bob = await makeUser(ctx);
    ownerC = await loginAs(ctx, owner.handle);
    aliceC = await loginAs(ctx, alice.handle);
    bobC = await loginAs(ctx, bob.handle);
  });
  afterAll(async () => drop());

  const make = (c: ReturnType<typeof client>, slug: string, visibility = 'public') => c.post('/api/v1/boards', { slug, name: `Board ${slug}`, visibility });

  describe('creating boards', () => {
    it('lets a trusted user create a board and records it in the audit log and the outbox', async () => {
      const r = await make(ownerC, 'general');
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ slug: 'general', visibility: 'public', owner: { handle: owner.handle }, can_post: true, can_moderate: true, unread: 0 });
      const a = first(await db.query(`SELECT actor_id, origin FROM audit_log WHERE action = 'board.created' AND target_id = $1`, [r.body.id]));
      expect(a).toEqual({ actor_id: owner.id, origin: 'web' });
      const ev = first(await db.query(`SELECT payload FROM events_outbox WHERE type = 'board.created' AND payload->>'board_id' = $1`, [r.body.id]));
      expect(ev.payload).toMatchObject({ slug: 'general', owner_id: owner.id });
    });
    it('refuses ordinary users and logged-out visitors', async () => {
      expect((await make(aliceC, 'nope')).status).toBe(403);
      expect((await make(visitor(), 'nope')).status).toBe(401);
    });
    it('refuses a taken, reserved or badly formed address', async () => {
      expect((await make(ownerC, 'general')).body.error.code).toBe('slug_taken');
      expect((await make(ownerC, 'New')).status).toBe(400);
      expect((await make(ownerC, 'has space')).status).toBe(400);
    });
    it('enforces the quota, not counting archived boards, and never lets two requests at once slip past it', async () => {
      ctx.deps.config.limits.trusted_board_quota = 3;
      const t = await makeUser(ctx, { role: 'trusted' });
      const c = await loginAs(ctx, t.handle);
      const results = await Promise.all(['q1', 'q2', 'q3', 'q4', 'q5'].map((s) => make(c, s)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.find((r) => r.status !== 201)!.body.error.code).toBe('quota_reached');
      const made = results.find((r) => r.status === 201)!.body.slug;
      expect((await c.patch(`/api/v1/boards/${made}`, { archived: true })).status).toBe(200);
      expect((await make(c, 'q6')).status).toBe(201);
      ctx.deps.config.limits.trusted_board_quota = 50;
    });
    it('does not limit admins', async () => {
      const admin = await makeAdmin(ctx);
      for (const s of ['a1', 'a2', 'a3', 'a4']) expect((await make(admin.client, s)).status).toBe(201);
    });
  });

  describe('who can see and post where', () => {
    beforeAll(async () => {
      await make(ownerC, 'members-only', 'members');
      await make(ownerC, 'secret', 'private');
      await ownerC.post('/api/v1/boards/secret/members', { handle: alice.handle });
    });
    const slugs = (r: { body: { boards: { slug: string }[] } }) => r.body.boards.map((b) => b.slug);

    it('shows a logged-out visitor public boards only, and refuses others without saying they exist', async () => {
      const v = visitor();
      expect(slugs(await v.get('/api/v1/boards'))).toContain('general');
      expect(slugs(await v.get('/api/v1/boards'))).not.toContain('members-only');
      expect(slugs(await v.get('/api/v1/boards'))).not.toContain('secret');
      const hidden = await v.get('/api/v1/boards/members-only');
      const missing = await v.get('/api/v1/boards/no-such-board');
      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(missing.body);
      expect((await v.get('/api/v1/boards/general')).body).toMatchObject({ unread: null, can_post: false });
    });
    it('shows members-only boards to users and private boards to their members alone', async () => {
      expect(slugs(await bobC.get('/api/v1/boards'))).toContain('members-only');
      expect(slugs(await bobC.get('/api/v1/boards'))).not.toContain('secret');
      expect((await bobC.get('/api/v1/boards/secret')).status).toBe(404);
      expect(slugs(await aliceC.get('/api/v1/boards'))).toContain('secret');
      expect((await aliceC.get('/api/v1/boards/secret')).body.can_post).toBe(true);
    });
    it('keeps private boards from admins who are not members', async () => {
      const admin = await makeAdmin(ctx);
      expect((await admin.client.get('/api/v1/boards/secret')).status).toBe(404);
    });
    it('lets only a confirmed user post', async () => {
      const g = await makeUser(ctx, { role: 'guest', verified: false });
      const gc = await loginAs(ctx, g.handle);
      const r = await gc.post('/api/v1/boards/general/posts', { subject: 'hi', body: 'hello' });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('email_not_verified');
      expect((await visitor().post('/api/v1/boards/general/posts', { subject: 'hi', body: 'hello' })).status).toBe(401);
    });
    it('refuses posts to a private board from someone who is not a member, as if it did not exist', async () => {
      expect((await bobC.post('/api/v1/boards/secret/posts', { subject: 'hi', body: 'hello' })).status).toBe(404);
    });
    it('makes an archived board read-only', async () => {
      await make(ownerC, 'old');
      await aliceC.post('/api/v1/boards/old/posts', { subject: 'before', body: 'x' });
      expect((await aliceC.patch('/api/v1/boards/old', { name: 'Hijacked' })).status).toBe(403);
      expect((await ownerC.patch('/api/v1/boards/old', { archived: true })).body).toMatchObject({ archived: true, can_post: false });
      const r = await aliceC.post('/api/v1/boards/old/posts', { subject: 'after', body: 'x' });
      expect(r.body.error.code).toBe('archived');
      expect((await visitor().get('/api/v1/boards/old/threads')).body.threads).toHaveLength(1);
    });
    it('moves the owner into the member list when a board goes private, and audits changes with before and after', async () => {
      await make(ownerC, 'flip');
      const r = await ownerC.patch('/api/v1/boards/flip', { visibility: 'private' });
      expect(r.body.visibility).toBe('private');
      expect((await ownerC.get('/api/v1/boards/flip/members')).body.members.map((m: { handle: string }) => m.handle)).toEqual([owner.handle]);
      const a = first(await db.query(`SELECT before, after FROM audit_log WHERE action = 'board.updated' AND target_id = $1`, [r.body.id]));
      expect(a.before.visibility).toBe('public');
      expect(a.after.visibility).toBe('private');
    });
    it('manages private board members: add, list, leave, and not the owner', async () => {
      expect((await bobC.get('/api/v1/boards/secret/members')).status).toBe(404);
      expect((await aliceC.get('/api/v1/boards/secret/members')).status).toBe(403);
      expect((await ownerC.post('/api/v1/boards/secret/members', { handle: alice.handle })).body.error.code).toBe('no_change');
      expect((await ownerC.post('/api/v1/boards/general/members', { handle: alice.handle })).body.error.code).toBe('not_private');
      expect((await ownerC.delete(`/api/v1/boards/secret/members/${owner.id}`)).body.error.code).toBe('owner');
      expect((await aliceC.delete(`/api/v1/boards/secret/members/${alice.id}`)).status).toBe(204);
      expect((await aliceC.get('/api/v1/boards/secret')).status).toBe(404);
      await ownerC.post('/api/v1/boards/secret/members', { handle: alice.handle });
    });
    it('lets only admins file a board under a category', async () => {
      const admin = await makeAdmin(ctx);
      const cat = await admin.client.post('/api/v1/admin/board-categories', { name: 'Talk' });
      expect(cat.status).toBe(201);
      expect((await ownerC.post('/api/v1/admin/board-categories', { name: 'Mine' })).status).toBe(403);
      expect((await ownerC.patch('/api/v1/boards/general', { category_id: cat.body.id })).status).toBe(403);
      const r = await admin.client.patch('/api/v1/boards/general', { category_id: cat.body.id });
      expect(r.body.category).toEqual({ id: cat.body.id, name: 'Talk' });
      const list = (await visitor().get('/api/v1/boards')).body;
      expect(list.categories).toContainEqual({ id: cat.body.id, name: 'Talk' });
    });
  });

  describe('threads and posts', () => {
    let thread: string;
    let reply: string;

    it('stores a post once with the right author, board and thread', async () => {
      const r = await aliceC.post('/api/v1/boards/general/posts', { subject: '  Hello   world ', body: 'First post.\r\nSecond line.' });
      expect(r.status).toBe(201);
      thread = r.body.id;
      expect(r.body).toMatchObject({ subject: 'Hello world', body: 'First post.\nSecond line.', thread_id: thread, reply_to_id: null, state: 'ok', author: { handle: alice.handle } });
      const rows = await db.query(`SELECT author_id, board_id, thread_root_id FROM posts WHERE id = $1`, [thread]);
      expect(rows.rows).toEqual([{ author_id: alice.id, board_id: (await ownerC.get('/api/v1/boards/general')).body.id, thread_root_id: null }]);
      const ev = first(await db.query(`SELECT payload FROM events_outbox WHERE type = 'post.created' AND payload->>'post_id' = $1`, [thread]));
      expect(ev.payload).toMatchObject({ author_id: alice.id, thread_id: thread, visibility: 'public' });
    });
    it('requires a subject to start a thread but not to reply', async () => {
      expect((await aliceC.post('/api/v1/boards/general/posts', { body: 'no subject' })).body.error.code).toBe('empty_subject');
      expect((await aliceC.post('/api/v1/boards/general/posts', { subject: 'x'.repeat(72), body: 'y' })).body.error.code).toBe('subject_too_long');
      const r = await bobC.post('/api/v1/boards/general/posts', { body: 'Reply here.', reply_to: thread });
      expect(r.status).toBe(201);
      reply = r.body.id;
      expect(r.body).toMatchObject({ subject: 'Re: Hello world', thread_id: thread, reply_to_id: thread });
    });
    it('keeps replies to replies in the same thread and refuses a reply on another board', async () => {
      const r = await aliceC.post('/api/v1/boards/general/posts', { body: 'Nested.', reply_to: reply });
      expect(r.body).toMatchObject({ thread_id: thread, reply_to_id: reply, subject: 'Re: Hello world' });
      await make(ownerC, 'other');
      expect((await aliceC.post('/api/v1/boards/other/posts', { body: 'x', reply_to: thread })).status).toBe(404);
    });
    it('lists threads with reply counts, newest activity first, and pages through them', async () => {
      await ownerC.post('/api/v1/boards/general/posts', { subject: 'Second thread', body: 'x' });
      let list = (await visitor().get('/api/v1/boards/general/threads')).body;
      expect(list.threads.map((t: { subject: string }) => t.subject)).toEqual(['Second thread', 'Hello world']);
      expect(list.threads[1]).toMatchObject({ reply_count: 2, author: { handle: alice.handle } });
      await bobC.post('/api/v1/boards/general/posts', { body: 'Bump.', reply_to: thread });
      list = (await visitor().get('/api/v1/boards/general/threads')).body;
      expect(list.threads.map((t: { subject: string }) => t.subject)).toEqual(['Hello world', 'Second thread']);
      const p1 = (await visitor().get('/api/v1/boards/general/threads?limit=1')).body;
      expect(p1.threads).toHaveLength(1);
      const p2 = (await visitor().get(`/api/v1/boards/general/threads?limit=1&before=${p1.next}`)).body;
      expect(p2.threads.map((t: { subject: string }) => t.subject)).toEqual(['Second thread']);
      expect(p2.next).toBeNull();
    });
    it('shows a whole thread in order', async () => {
      const r = (await visitor().get(`/api/v1/boards/general/threads/${thread}`)).body;
      expect(r.posts).toHaveLength(4);
      expect(r.posts.map((p: { seq: number }) => p.seq)).toEqual([...r.posts.map((p: { seq: number }) => p.seq)].sort((a, b) => a - b));
      expect(r.posts[0].id).toBe(thread);
      const after = (await visitor().get(`/api/v1/boards/general/threads/${thread}?after=${r.posts[1].seq}`)).body;
      expect(after.posts).toHaveLength(2);
      expect((await visitor().get(`/api/v1/boards/general/threads/${reply}`)).status).toBe(404); // a reply is not a thread
    });
    it('shows the preview text byte for byte as it is stored', async () => {
      const body = 'Line one   \r\n\r\nLine   two with café and ✓\t!';
      const preview = (await aliceC.post('/api/v1/boards/general/posts/preview', { body })).body;
      const saved = (await aliceC.post('/api/v1/boards/general/posts', { subject: 'Preview check', body })).body;
      expect(saved.body).toBe(preview.stored);
      expect(preview.wrapped.join('\n')).toBe(preview.stored);
      expect(preview.warnings).toHaveLength(1);
    });
    it('deletes your own post as a tombstone, and nobody else can delete it', async () => {
      const p = (await aliceC.post('/api/v1/boards/general/posts', { subject: 'Oops', body: 'private thing' })).body;
      const r = (await bobC.post('/api/v1/boards/general/posts', { body: 'a reply', reply_to: p.id })).body;
      expect((await bobC.delete(`/api/v1/posts/${p.id}`)).status).toBe(403);
      expect((await visitor().delete(`/api/v1/posts/${p.id}`)).status).toBe(401);
      expect((await aliceC.delete(`/api/v1/posts/${p.id}`)).status).toBe(204);
      expect((await aliceC.delete(`/api/v1/posts/${p.id}`)).body.error.code).toBe('no_change');
      const t = (await visitor().get(`/api/v1/boards/general/threads/${p.id}`)).body;
      expect(t.posts[0]).toMatchObject({ id: p.id, state: 'deleted', subject: '', body: null, author: null });
      expect(t.posts[1].id).toBe(r.id);
      expect(first(await db.query(`SELECT body FROM posts WHERE id = $1`, [p.id])).body).toBe('');
      expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'post.deleted' AND target_id = $1`, [p.id])).n).toBe(1);
    });
    it('does not reveal or let anyone delete a post on a board they cannot read', async () => {
      const p = (await ownerC.post('/api/v1/boards/secret/posts', { subject: 'Members only', body: 'x' })).body;
      expect((await bobC.delete(`/api/v1/posts/${p.id}`)).status).toBe(404);
      expect((await bobC.get(`/api/v1/boards/secret/threads/${p.id}`)).status).toBe(404);
    });
  });

  describe('read state', () => {
    it('counts other people’s posts as unread, moves the pointer forward only, and never counts your own', async () => {
      const c = await makeUser(ctx);
      const cc = await loginAs(ctx, c.handle);
      await make(ownerC, 'unread');
      const post = async (cl: ReturnType<typeof client>, subject: string, reply_to?: string) =>
        (await cl.post('/api/v1/boards/unread/posts', { subject, body: 'x', reply_to })).body;
      const p1 = await post(aliceC, 'one');
      const p2 = await post(aliceC, 'two');
      await post(cc, 'mine');
      const unread = async () => (await cc.get('/api/v1/boards/unread')).body.unread;
      expect(await unread()).toBe(2);
      const threads = async () => (await cc.get('/api/v1/boards/unread/threads')).body.threads as { id: string; unread: boolean }[];
      expect((await threads()).filter((t) => t.unread).map((t) => t.id).sort()).toEqual([p1.id, p2.id].sort());

      expect((await cc.put('/api/v1/boards/unread/read-pointer', { post_id: p2.id })).status).toBe(204);
      expect(await unread()).toBe(0);
      await cc.put('/api/v1/boards/unread/read-pointer', { post_id: p1.id }); // going back does nothing
      expect(await unread()).toBe(0);
      const p4 = await post(bobC, 'new');
      expect(await unread()).toBe(1);
      expect((await threads()).find((t) => t.id === p4.id)!.unread).toBe(true);
      await cc.put('/api/v1/boards/unread/read-pointer', { all: true });
      expect(await unread()).toBe(0);
      expect((await cc.put('/api/v1/boards/unread/read-pointer', { post_id: p1.id.replace(/.$/, '0') })).status).toBe(404);
      expect((await visitor().put('/api/v1/boards/unread/read-pointer', { all: true })).status).toBe(401);
    });
    it('marks a thread unread again when someone replies to it', async () => {
      const c = await makeUser(ctx);
      const cc = await loginAs(ctx, c.handle);
      const t = (await aliceC.post('/api/v1/boards/general/posts', { subject: 'Revisit', body: 'x' })).body;
      await cc.put('/api/v1/boards/general/read-pointer', { all: true });
      expect((await cc.get('/api/v1/boards/general/threads')).body.threads.find((x: { id: string }) => x.id === t.id).unread).toBe(false);
      await bobC.post('/api/v1/boards/general/posts', { body: 'more', reply_to: t.id });
      expect((await cc.get('/api/v1/boards/general/threads')).body.threads.find((x: { id: string }) => x.id === t.id).unread).toBe(true);
    });
    it('watches and unwatches a board', async () => {
      expect((await bobC.put('/api/v1/boards/general/watch')).status).toBe(204);
      expect((await bobC.get('/api/v1/boards/general')).body.watching).toBe(true);
      expect((await bobC.delete('/api/v1/boards/general/watch')).status).toBe(204);
      expect((await bobC.get('/api/v1/boards/general')).body.watching).toBe(false);
    });
  });

  describe('search', () => {
    beforeAll(async () => {
      await aliceC.post('/api/v1/boards/general/posts', { subject: 'Gardening', body: 'My tomatoes are ripening early this year.' });
      await ownerC.post('/api/v1/boards/secret/posts', { subject: 'Plans', body: 'The tomatoes conspiracy is secret.' });
      await ownerC.post('/api/v1/boards/members-only/posts', { subject: 'Users', body: 'Tomatoes for users only.' });
    });
    it('finds posts with stemming and marks the match', async () => {
      const r = (await visitor().get('/api/v1/search?q=tomato')).body;
      expect(r.hits).toHaveLength(1);
      expect(r.hits[0]).toMatchObject({ board: { slug: 'general' }, post: { subject: 'Gardening' } });
      expect(r.hits[0].snippet).toMatch(/\u0002tomatoes\u0003/);
    });
    it('searches only what the viewer may read', async () => {
      const slugsFor = async (c: ReturnType<typeof client>) => ((await c.get('/api/v1/search?q=tomatoes')).body.hits as { board: { slug: string } }[]).map((h) => h.board.slug).sort();
      expect(await slugsFor(visitor())).toEqual(['general']);
      expect(await slugsFor(bobC)).toEqual(['general', 'members-only']);
      expect(await slugsFor(aliceC)).toEqual(['general', 'members-only', 'secret']);
    });
    it('narrows to one board, skips deleted posts and rejects a tiny query', async () => {
      expect((await aliceC.get('/api/v1/search?q=tomatoes&board=secret')).body.hits).toHaveLength(1);
      const p = (await aliceC.post('/api/v1/boards/general/posts', { subject: 'Zucchini', body: 'zucchini zucchini' })).body;
      expect((await visitor().get('/api/v1/search?q=zucchini')).body.hits).toHaveLength(1);
      await aliceC.delete(`/api/v1/posts/${p.id}`);
      expect((await visitor().get('/api/v1/search?q=zucchini')).body.hits).toHaveLength(0);
      expect((await visitor().get('/api/v1/search?q=a')).status).toBe(400);
    });
  });
});
