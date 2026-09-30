import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';
import { pullCharacters } from './characters';
import { mudSecrets } from './mud/secrets';

const secrets = mudSecrets('characters-test-secret-0123456789abcdefghij');

// A stand-in for the MUD's /internal/characters, so these tests need no Evennia (the real one is covered
// by mud/sync.test.ts).
function fakeMud(answer: () => object): Promise<{ url: string; server: Server; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.headers.authorization ?? '');
    if (req.headers.authorization !== `Bearer ${secrets.controlToken}`) { res.writeHead(403).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer()));
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

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    mud = await fakeMud(() => ({ characters }));
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

  it('shows characters on a public profile, to anyone, and nothing for guests or suspended people', async () => {
    const bo = await makeUser(ctx, { handle: 'bochars' });
    characters = [sheet('c_20', bo.id, 'Rook', 2)];
    await pullCharacters(ctx.deps);
    const p = (await client(ctx.app).get('/api/v1/users/BOCHARS')).body;
    expect(p).toMatchObject({ handle: 'bochars', role: 'user', featured_character_id: null, homepage_url: null, rings: [] });
    expect(p.characters).toEqual([{ id: 'c_20', name: 'Rook', level: 2, xp: 200, hp: 7, hp_max: 9, coins: 12, abilities: { strength: 2, dexterity: 1, constitution: 3, intelligence: 1, wisdom: 2, charisma: 1 }, created_at: '2026-09-30T10:00:00.000Z' }]);
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
});
