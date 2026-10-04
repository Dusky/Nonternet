import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';
import { pullCharacters, pullOnce } from './characters';
import { mudSecrets } from './mud/secrets';

const secrets = mudSecrets('characters-test-secret-0123456789abcdefghij');

// A stand-in for the MUD's /internal/characters, so these tests need no Evennia (the real one is covered
// by mud/sync.test.ts).
function fakeMud(answer: () => object, delay: () => number = () => 0): Promise<{ url: string; server: Server; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.headers.authorization ?? '');
    if (req.headers.authorization !== `Bearer ${secrets.controlToken}`) { res.writeHead(403).end(); return; }
    // The answer is taken when the request arrives; a delay holds it back, like a slow MUD.
    const body = JSON.stringify(answer());
    setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(body), delay());
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, server, calls })));
}

const sheet = (id: string, coreId: string, name: string, level = 1) => ({
  id, core_id: coreId, name, created: '2026-09-30T10:00:00Z', level, xp: level * 100, hp: 7, hp_max: 9, coins: 12,
  abilities: { strength: 2, dexterity: 1, constitution: 3, intelligence: 1, wisdom: 2, charisma: 1 },
});

describe.skipIf(!dbAvailable)('MUD characters around the site', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let mud: Awaited<ReturnType<typeof fakeMud>>;
  let characters: object[] = [];
  let delays: number[] = [];

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    mud = await fakeMud(() => ({ characters }), () => delays.shift() ?? 0);
    ctx = await makeApp(db, { mud: { secrets, url: mud.url } });
  });
  afterAll(async () => { mud.server.close(); await drop(); });

  it('keeps a copy of everyone’s characters, follows changes and forgets deleted ones', async () => {
    const ann = await makeUser(ctx, { handle: 'annchars' });
    characters = [sheet('c_10', ann.id, 'Wren'), sheet('c_11', ann.id, 'Moss'), sheet('c_99', 'u_00000000000000000000000000', 'Stranger')];
    expect(await pullCharacters(ctx.deps)).toEqual({ saved: 2, removed: 0 }); // the stranger has no account here
    characters = [sheet('c_10', ann.id, 'Wren', 3)];
    expect(await pullCharacters(ctx.deps)).toEqual({ saved: 1, removed: 1 });
    const rows = (await db.query(`SELECT id, name, level FROM mud_characters WHERE user_id = $1`, [ann.id])).rows;
    expect(rows).toEqual([{ id: 'c_10', name: 'Wren', level: 3 }]);
    expect(mud.calls.at(-1)).toBe(`Bearer ${secrets.controlToken}`);
  });

  it('keeps each character\u2019s climb and ranks the latest season\u2019s highest floors, active people only', async () => {
    const cy = await makeUser(ctx, { handle: 'cyclimb' });
    const di = await makeUser(ctx, { handle: 'diclimb' });
    const gone = await makeUser(ctx, { handle: 'goneclimb' });
    const climb = (s: object, season: number | null, best: number) => ({ ...s, tower: { season, best, checkpoint: best >= 10 ? 10 : 0 } });
    characters = [
      climb(sheet('c_30', cy.id, 'Ash', 4), 2, 12), climb(sheet('c_31', di.id, 'Birch', 6), 2, 12), climb(sheet('c_32', di.id, 'Cedar', 2), 2, 3),
      climb(sheet('c_33', cy.id, 'Old', 9), 1, 40), climb(sheet('c_34', gone.id, 'Gone', 5), 2, 50), sheet('c_35', cy.id, 'Never'),
    ];
    await pullCharacters(ctx.deps);
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [gone.id]);
    const board = (await (await loginAs(ctx, cy.handle)).get('/api/v1/mud/leaderboard')).body;
    expect(board.season).toBe(2);
    expect(board.leaders).toEqual([
      { name: 'Birch', level: 6, best: 12, handle: 'diclimb' }, // ties go to the higher level
      { name: 'Ash', level: 4, best: 12, handle: 'cyclimb' },
      { name: 'Cedar', level: 2, best: 3, handle: 'diclimb' },
    ]); // last season's climb and a suspended person are left out
    expect((await client(ctx.app).get('/api/v1/mud/leaderboard')).status).toBe(401); // signed in only
    const p = (await client(ctx.app).get('/api/v1/users/cyclimb')).body;
    expect(p.characters.find((c: { name: string }) => c.name === 'Ash').tower).toEqual({ season: 2, best: 12, checkpoint: 10 });
  });

  it('shows characters on a public profile, to anyone, and nothing for guests or suspended people', async () => {
    const bo = await makeUser(ctx, { handle: 'bochars' });
    characters = [sheet('c_20', bo.id, 'Rook', 2)];
    await pullCharacters(ctx.deps);
    const p = (await client(ctx.app).get('/api/v1/users/BOCHARS')).body;
    expect(p).toMatchObject({ handle: 'bochars', role: 'user', featured_character_id: null, homepage_url: null, rings: [] });
    expect(p.characters).toEqual([{ id: 'c_20', name: 'Rook', level: 2, xp: 200, hp: 7, hp_max: 9, coins: 12, abilities: { strength: 2, dexterity: 1, constitution: 3, intelligence: 1, wisdom: 2, charisma: 1 }, created_at: '2026-09-30T10:00:00.000Z', tower: null }]);
    expect(p).not.toHaveProperty('email');
    const guest = await makeUser(ctx, { role: 'guest', verified: false });
    expect((await client(ctx.app).get(`/api/v1/users/${guest.handle}`)).status).toBe(404);
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [bo.id]);
    expect((await client(ctx.app).get('/api/v1/users/bochars')).status).toBe(404);
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [bo.id]);
  });

  it('lets someone feature one of their own characters, which then shows on their posts', async () => {
    const cy = await makeUser(ctx, { handle: 'cychars', role: 'trusted' });
    const other = await makeUser(ctx, { handle: 'otherchars' });
    characters = [sheet('c_30', cy.id, 'Tansy', 4), sheet('c_31', other.id, 'Nope')];
    await pullCharacters(ctx.deps);
    const c = await loginAs(ctx, cy.handle);
    expect((await c.get('/api/v1/me/characters')).body).toMatchObject({ featured_character_id: null, characters: [{ id: 'c_30', name: 'Tansy' }] });
    expect((await c.put('/api/v1/me/featured-character', { character_id: 'c_31' })).status).toBe(404); // not theirs
    expect((await c.put('/api/v1/me/featured-character', { character_id: 'c_30' })).status).toBe(204);
    expect((await client(ctx.app).get('/api/v1/users/cychars')).body.featured_character_id).toBe('c_30');

    await c.post('/api/v1/boards', { slug: 'tavern', name: 'Tavern', visibility: 'public' });
    const post = (await c.post('/api/v1/boards/tavern/posts', { subject: 'Hail', body: 'Well met.' })).body;
    expect(post.author.character).toEqual({ id: 'c_30', name: 'Tansy', level: 4 });
    const thread = (await client(ctx.app).get(`/api/v1/boards/tavern/threads/${post.id}`)).body;
    expect(thread.posts[0].author.character).toEqual({ id: 'c_30', name: 'Tansy', level: 4 });

    // The character is deleted in the MUD: the badge goes, and so does the choice.
    characters = [];
    await pullCharacters(ctx.deps);
    expect((await client(ctx.app).get(`/api/v1/boards/tavern/threads/${post.id}`)).body.posts[0].author.character).toBeNull();
    expect((await c.get('/api/v1/me/characters')).body.featured_character_id).toBeNull();
    expect((await c.put('/api/v1/me/featured-character', { character_id: null })).status).toBe(204);
  });

  it('an older list arriving late never removes a newer character, or the choice to feature it', async () => {
    const eve = await makeUser(ctx, { handle: 'evechars' });
    characters = [sheet('c_50', eve.id, 'Fern')];
    await pullCharacters(ctx.deps);
    // A pull starts and the MUD is slow to answer, with the list as it was: no Gale yet.
    delays = [400, 0];
    const older = pullCharacters(ctx.deps);
    await new Promise((r) => setTimeout(r, 50));
    // Gale is made; the MUD nudges core, and that pull answers at once.
    characters = [sheet('c_50', eve.id, 'Fern'), sheet('c_51', eve.id, 'Gale')];
    const newer = pullCharacters(ctx.deps);
    await Promise.all([older, newer]);
    await db.query(`UPDATE users SET featured_character_id = 'c_51' WHERE id = $1`, [eve.id]);
    // Another round in the same order must not undo it either.
    delays = [400, 0];
    const again = pullCharacters(ctx.deps);
    await new Promise((r) => setTimeout(r, 50));
    await Promise.all([again, pullCharacters(ctx.deps)]);
    expect((await db.query(`SELECT id FROM mud_characters WHERE user_id = $1 ORDER BY id`, [eve.id])).rows.map((r) => r.id)).toEqual(['c_50', 'c_51']);
    expect((await db.query(`SELECT featured_character_id AS f FROM users WHERE id = $1`, [eve.id])).rows[0]!.f).toBe('c_51');
  });

  it('even without the queue (two cores at once), an older list neither removes nor rolls back what a newer one saved', async () => {
    const fay = await makeUser(ctx, { handle: 'faychars' });
    characters = [sheet('c_60', fay.id, 'Hazel', 1)];
    await pullCharacters(ctx.deps);
    delays = [400, 0];
    const older = pullOnce(ctx.deps); // asks first, answered last, with the old list
    await new Promise((r) => setTimeout(r, 50));
    characters = [sheet('c_60', fay.id, 'Hazel', 2), sheet('c_61', fay.id, 'Ivy')];
    const newer = pullOnce(ctx.deps);
    await Promise.all([older, newer]);
    const rows = (await db.query(`SELECT id, level FROM mud_characters WHERE user_id = $1 ORDER BY id`, [fay.id])).rows;
    expect(rows).toEqual([{ id: 'c_60', level: 2 }, { id: 'c_61', level: 1 }]);
  });
});
