import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { describeImages, imageIds, parseWiki } from '@app/shared';
import { usedBytes } from './images';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, ORIGIN } from './test/harness';

describe('picture markup', () => {
  const id = 'i_01M4FHAPC3MN4D6FDTNX4FN9QJ';
  it('is found in a text, once each, and described in words for plain readers', () => {
    expect(imageIds(`a ![red door](image:${id}) b ![again](image:${id})`)).toEqual([id]);
    expect(describeImages(`see ![red door](image:${id})`, 'https://site.test/')).toBe(`see [picture: red door] https://site.test/api/v1/images/${id}`);
    expect(describeImages(`![](image:${id})`, 'https://site.test')).toContain('[picture: no description]');
  });
  it('only draws pictures this site made: any other address stays as text', () => {
    const segs = parseWiki(`![x](image:${id}) ![evil](https://evil.example/a.png) ![x](image:nope)`)[0]!;
    expect(segs.kind).toBe('paragraph');
    const inl = (segs as { content: { kind: string }[] }).content;
    expect(inl.filter((s) => s.kind === 'image')).toHaveLength(1);
  });
});

describe.skipIf(!dbAvailable)('pictures in posts and mail', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); ctx.deps.config.limits.trusted_board_quota = 50; });
  afterAll(async () => drop());
  const person = async (role: 'user' | 'trusted' = 'user') => { const u = await makeUser(ctx, { role }); return { ...u, c: await loginAs(ctx, u.handle) }; };
  const png = (w = 2400, h = 1200) => sharp({ create: { width: w, height: h, channels: 3, background: '#cc3366' } }).withMetadata({ exif: { IFD0: { Copyright: 'secret place' } } }).png().toBuffer();
  const up = (c: { sid?: string }, body: Buffer | string, alt = 'a red picture') =>
    ctx.app.inject({ method: 'POST', url: `/api/v1/images?alt=${encodeURIComponent(alt)}`, payload: body, headers: { origin: ORIGIN, cookie: `sid=${c.sid}`, 'content-type': 'application/octet-stream' } });
  const get = (c: { sid?: string } | null, id: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/images/${id}`, headers: c ? { cookie: `sid=${c.sid}` } : {} });
  const mark = (id: string, alt = 'a red picture') => `![${alt}](image:${id})`;

  it('draws an upload again as a smaller plain WebP with no metadata, and refuses what is not a picture', async () => {
    const a = await person();
    const r = await up(a.c, await png());
    expect(r.statusCode).toBe(201);
    const { id, width, height } = r.json();
    expect(id).toMatch(/^i_/);
    expect(width).toBe(1600);
    expect(height).toBe(800);
    const back = await get(a.c, id);
    expect(back.headers['content-type']).toBe('image/webp');
    expect(back.headers['x-content-type-options']).toBe('nosniff');
    const meta = await sharp(back.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect((await up(a.c, 'definitely not a picture')).statusCode).toBe(400);
    expect((await up(a.c, Buffer.alloc(0))).statusCode).toBe(400);
  });

  it('is private to its owner until a post uses it, then seen by whoever can read the post', async () => {
    const owner = await person('trusted'); const reader = await person(); const outsider = await person();
    await owner.c.post('/api/v1/boards', { slug: 'pub', name: 'Pub', visibility: 'public' });
    await owner.c.post('/api/v1/boards', { slug: 'priv', name: 'Priv', visibility: 'private' });
    await owner.c.post('/api/v1/boards/priv/members', { handle: reader.handle });
    const a = (await up(owner.c, await png(300, 200))).json().id as string;
    expect((await get(reader.c, a)).statusCode).toBe(404); // not attached yet
    expect((await get(owner.c, a)).statusCode).toBe(200);
    const post = (await owner.c.post('/api/v1/boards/pub/posts', { subject: 'Pic', body: `look ${mark(a)}` })).body;
    expect((await get(null, a)).statusCode).toBe(200); // a visitor can see pictures on a public board
    expect((await get(reader.c, a)).headers['cache-control']).toContain('public');
    // Someone else can't claim it for their own post.
    expect((await reader.c.post('/api/v1/boards/pub/posts', { subject: 'Steal', body: mark(a) })).status).toBe(400);
    // A private board's picture is only for its members.
    const b = (await up(owner.c, await png(300, 200))).json().id as string;
    const priv = (await owner.c.post('/api/v1/boards/priv/posts', { subject: 'Secret pic', body: mark(b) })).body;
    expect((await get(reader.c, b)).statusCode).toBe(200);
    expect((await get(outsider.c, b)).statusCode).toBe(404);
    expect((await get(null, b)).statusCode).toBe(404);
    // Hiding the post takes its picture away from ordinary readers.
    await ctx.deps.db.query(`UPDATE posts SET hidden_at = now() WHERE id = $1`, [priv.id]);
    expect((await get(reader.c, b)).statusCode).toBe(404);
    expect(post.id).toBeTruthy();
  });

  it('allows four pictures a post, drops ones an edit no longer uses, and counts them in the file quota', async () => {
    const t = await person('trusted');
    await t.c.post('/api/v1/boards', { slug: 'four', name: 'Four', visibility: 'public' });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await up(t.c, await png(200, 100))).json().id);
    expect((await t.c.post('/api/v1/boards/four/posts', { subject: 'Too many', body: ids.map((i) => mark(i)).join(' ') })).status).toBe(400);
    const p = (await t.c.post('/api/v1/boards/four/posts', { subject: 'Four', body: ids.slice(0, 4).map((i) => mark(i)).join(' ') })).body;
    expect(await usedBytes(ctx.deps.db, t.id)).toBeGreaterThan(0);
    const edited = await t.c.patch(`/api/v1/posts/${p.id}`, { body: mark(ids[0]!) });
    expect(edited.status).toBe(200);
    expect((await get(t.c, ids[1]!)).statusCode).toBe(404);
    expect((await get(t.c, ids[0]!)).statusCode).toBe(200);
  });

  it('works in mail: only the people in the conversation can see it', async () => {
    const a = await person(); const b = await person(); const c = await person();
    const id = (await up(a.c, await png(300, 200))).json().id as string;
    const t = (await a.c.post('/api/v1/mail', { to: [b.handle], subject: 'Pic', body: `here ${mark(id)}` })).body;
    expect(t.id).toMatch(/^mt_/);
    expect((await get(b.c, id)).statusCode).toBe(200);
    expect((await get(c.c, id)).statusCode).toBe(404);
    expect((await get(null, id)).statusCode).toBe(404);
  });

  it('can be taken down by an admin, with the action on the record, and goes when an unused upload is a day old', async () => {
    const t = await person('trusted'); const admin = await makeAdmin(ctx);
    await t.c.post('/api/v1/boards', { slug: 'mod', name: 'Mod', visibility: 'public' });
    const id = (await up(t.c, await png(200, 100))).json().id as string;
    await t.c.post('/api/v1/boards/mod/posts', { subject: 'Pic', body: mark(id) });
    expect((await admin.client.post(`/api/v1/admin/images/${id}/hide`, { reason: 'not allowed here' })).status).toBe(204);
    expect((await get(t.c, id)).statusCode).toBe(404);
    expect((await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action = 'image.hidden' AND target_id = $1`, [id])).rowCount).toBe(1);
    const stale = (await up(t.c, await png(100, 100))).json().id as string;
    await ctx.deps.db.query(`UPDATE images SET created_at = now() - interval '2 days' WHERE id = $1`, [stale]);
    await up(t.c, await png(100, 100)); // any upload sweeps old unused ones
    await new Promise((r) => setTimeout(r, 200));
    expect((await ctx.deps.db.query(`SELECT 1 FROM images WHERE id = $1`, [stale])).rowCount).toBe(0);
  });
});
