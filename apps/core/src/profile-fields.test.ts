import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Profiles and directories (docs/23, E5).
describe.skipIf(!dbAvailable)('profile fields, recent activity and the homepage directory', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); ctx.deps.config.limits.trusted_board_quota = 50; });
  afterAll(async () => drop());
  const person = async (role: 'user' | 'trusted' = 'user') => { const u = await makeUser(ctx, { role }); return { ...u, c: await loginAs(ctx, u.handle) }; };

  it('saves pronouns, location and up to four safe links, and shows them publicly', async () => {
    const a = await person();
    const links = [{ label: 'Blog', url: 'https://example.org/blog' }, { label: '', url: 'gemini://example.org/' }];
    expect((await a.c.patch('/api/v1/me', { pronouns: 'she/her', location: 'Somewhere windy', links })).status).toBe(200);
    const pub = (await a.c.get(`/api/v1/users/${a.handle}`)).body;
    expect(pub).toMatchObject({ pronouns: 'she/her', location: 'Somewhere windy', links });
    expect((await a.c.get('/api/v1/me/personal')).body).toMatchObject({ pronouns: 'she/her', links });
    // Refused: dangerous schemes, too many, line breaks, too long.
    expect((await a.c.patch('/api/v1/me', { links: [{ label: 'x', url: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await a.c.patch('/api/v1/me', { links: [{ label: 'x', url: 'data:text/html,hi' }] })).status).toBe(400);
    expect((await a.c.patch('/api/v1/me', { links: Array.from({ length: 5 }, (_, i) => ({ label: '', url: `https://example.org/${i}` })) })).status).toBe(400);
    expect((await a.c.patch('/api/v1/me', { pronouns: 'a\nb' })).status).toBe(400);
    expect((await a.c.patch('/api/v1/me', { location: 'x'.repeat(61) })).status).toBe(400);
    // Cleared by sending nothing.
    await a.c.patch('/api/v1/me', { pronouns: '', location: null, links: [] });
    expect((await a.c.get(`/api/v1/users/${a.handle}`)).body).toMatchObject({ pronouns: null, location: null, links: [] });
  });

  it('keeps the fields as plain columns on the account (export and deletion are covered by the export suite)', async () => {
    const a = await person();
    await a.c.patch('/api/v1/me', { pronouns: 'they/them', links: [{ label: 'Home', url: 'https://example.org/' }] });
    const row = (await ctx.deps.db.query(`SELECT pronouns, links FROM users WHERE id = $1`, [a.id])).rows[0]!;
    expect(row.pronouns).toBe('they/them');
    expect(row.links).toEqual([{ label: 'Home', url: 'https://example.org/' }]);
  });

  it('lists recent public activity: public posts, and wiki pages anyone can read', async () => {
    const t = await person('trusted');
    await t.c.post('/api/v1/boards', { slug: 'actpub', name: 'Public', visibility: 'public' });
    await t.c.post('/api/v1/boards', { slug: 'actpriv', name: 'Private', visibility: 'private' });
    await t.c.post('/api/v1/boards/actpub/posts', { subject: 'Seen by all', body: 'x' });
    await t.c.post('/api/v1/boards/actpriv/posts', { subject: 'Secret', body: 'x' });
    expect((await t.c.put('/api/v1/wiki/site/pages/activity-test', { title: 'Activity test', body: 'hello', base_revision: 0, summary: '' })).status).toBeLessThan(300);
    const act = (await t.c.get(`/api/v1/users/${t.handle}`)).body.activity as { kind: string; title: string }[];
    expect(act.map((x) => `${x.kind}:${x.title}`)).toEqual(expect.arrayContaining(['post:Seen by all', 'wiki:Activity test']));
    expect(JSON.stringify(act)).not.toContain('Secret');
  });

  it('filters the homepage directory by newness and ring', async () => {
    const a = await person('trusted'); const b = await person();
    for (const [p, body] of [[a, 'hi'], [b, 'hello']] as const) {
      await ctx.deps.db.query(`INSERT INTO homepages (user_id, title, has_index, last_updated_at) VALUES ($1, $2, true, now())`, [p.id, `Page of ${p.handle}`]);
      void body;
    }
    await ctx.deps.db.query(`UPDATE homepages SET created_at = now() - interval '30 days' WHERE user_id = $1`, [b.id]);
    const all = (await a.c.get('/api/v1/homepages')).body.homepages.map((h: { handle: string }) => h.handle);
    expect(all).toEqual(expect.arrayContaining([a.handle, b.handle]));
    const fresh = (await a.c.get('/api/v1/homepages?filter=new')).body.homepages.map((h: { handle: string }) => h.handle);
    expect(fresh).toContain(a.handle);
    expect(fresh).not.toContain(b.handle);
    const none = (await a.c.get('/api/v1/homepages?ring=no-such-ring')).body.homepages;
    expect(none).toEqual([]);
  });
});
