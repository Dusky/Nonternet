import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { processNext } from './exports/service';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';

// The wiki (docs/20): who may read and edit, revisions and conflicts, revert, rename, links, search, moderation,
// reports, ring wikis, and what happens to someone's writing in their export and when they leave.
describe.skipIf(!dbAvailable)('wiki', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type C = ReturnType<typeof client>;
  const people: Record<string, { id: string; handle: string; c: C }> = {};
  let admin: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
    for (const [name, role] of [['tess', 'trusted'], ['tom', 'trusted'], ['ursula', 'user'], ['gail', 'guest']] as const) {
      const u = await makeUser(ctx, { handle: name, role });
      people[name] = { id: u.id, handle: u.handle, c: await loginAs(ctx, u.handle) };
    }
  });
  afterAll(async () => drop());

  const p = (n: string) => people[n]!;
  const page = (c: C, slug: string, ref = 'site') => c.get(`/api/v1/wiki/${ref}/pages/${slug}`);
  const save = (c: C, slug: string, body: { title: string; body: string; base_revision: number; summary?: string }, ref = 'site') => c.put(`/api/v1/wiki/${ref}/pages/${slug}`, body);

  it('trusted people start and edit pages; users and guests read only; visitors read the site wiki', async () => {
    expect((await save(p('ursula').c, 'home', { title: 'Home', body: 'hi', base_revision: 0 })).status).toBe(403);
    expect((await save(p('gail').c, 'home', { title: 'Home', body: 'hi', base_revision: 0 })).status).toBe(403);
    const made = await save(p('tess').c, 'home', { title: 'Home', body: 'Welcome. See [[Getting Started]] and [[FAQ|questions]].', base_revision: 0, summary: 'First version' });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ slug: 'home', title: 'Home', revision: 1, can_edit: true });
    expect(made.body.links).toEqual([{ slug: 'faq', title: 'FAQ', exists: false }, { slug: 'getting-started', title: 'Getting Started', exists: false }]);
    const visitor = await page(client(ctx.app), 'home');
    expect(visitor.status).toBe(200);
    expect(visitor.body.can_edit).toBe(false);
    expect((await client(ctx.app).get('/api/v1/wiki/site')).body).toMatchObject({ can_edit: false, scope: 'site' });
    expect((await p('ursula').c.get('/api/v1/wiki/site')).body.can_edit).toBe(false);
    // A title that names a different page is refused: that's a rename.
    expect((await save(p('tess').c, 'home', { title: 'Start', body: 'x', base_revision: 1 })).body.error.code).toBe('title_mismatch');
  });

  it('refuses an edit that started from an older revision, sending back the page as it is now', async () => {
    const first = await save(p('tom').c, 'home', { title: 'Home', body: 'Welcome, all. See [[Getting Started]].', base_revision: 1 });
    expect(first.body.revision).toBe(2);
    const late = await save(p('tess').c, 'home', { title: 'Home', body: 'My version', base_revision: 1 });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('edit_conflict');
    expect(late.body.error.current).toMatchObject({ revision: 2, body: 'Welcome, all. See [[Getting Started]].' });
    expect((await page(p('tess').c, 'home')).body.body).toBe('Welcome, all. See [[Getting Started]].'); // nothing overwritten
    // Saving the same text makes no empty revision.
    expect((await save(p('tom').c, 'home', { title: 'Home', body: 'Welcome, all. See [[Getting Started]].', base_revision: 2 })).body.revision).toBe(2);
  });

  it('keeps every revision, compares them, and reverts by making a new one', async () => {
    const hist = (await p('ursula').c.get('/api/v1/wiki/site/pages/home/history')).body.revisions;
    expect(hist.map((r: { revision: number; editor: { handle: string } }) => [r.revision, r.editor.handle])).toEqual([[2, 'tom'], [1, 'tess']]);
    expect(hist[1].summary).toBe('First version');
    expect((await p('ursula').c.get('/api/v1/wiki/site/pages/home/revisions/1')).body.body).toContain('[[FAQ|questions]]');
    const back = await p('tess').c.post('/api/v1/wiki/site/pages/home/revert', { revision: 1, base_revision: 2 });
    expect(back.body).toMatchObject({ revision: 3, body: 'Welcome. See [[Getting Started]] and [[FAQ|questions]].' });
    expect((await p('tess').c.get('/api/v1/wiki/site/pages/home/history')).body.revisions[0]).toMatchObject({ revision: 3, reverted_to: 1, summary: 'Reverted to revision 1' });
  });

  it('renames with a redirect, and knows which pages link where and which are wanted', async () => {
    await save(p('tess').c, 'getting-started', { title: 'Getting Started', body: 'Steps. Back to [[Home]].', base_revision: 0 });
    expect((await p('ursula').c.get('/api/v1/wiki/site/wanted')).body.wanted).toEqual([{ slug: 'faq', title: 'FAQ', count: 1 }]);
    expect((await p('ursula').c.get('/api/v1/wiki/site/pages/getting-started/links-here')).body.pages.map((x: { slug: string }) => x.slug)).toEqual(['home']);
    const moved = await p('tom').c.post('/api/v1/wiki/site/pages/getting-started/rename', { title: 'First Steps', base_revision: 1 });
    expect(moved.body).toMatchObject({ slug: 'first-steps', title: 'First Steps', revision: 2 });
    const old = await page(p('ursula').c, 'getting-started');
    expect(old.body).toMatchObject({ slug: 'first-steps', redirected_from: 'getting-started' });
    // Home still links to the old name, which now leads somewhere.
    expect((await page(p('ursula').c, 'home')).body.links.find((l: { slug: string }) => l.slug === 'getting-started').exists).toBe(true);
    expect((await p('ursula').c.get('/api/v1/wiki/site/pages/first-steps/links-here')).body.pages.map((x: { slug: string }) => x.slug)).toEqual(['home']);
    expect((await p('tom').c.post('/api/v1/wiki/site/pages/first-steps/rename', { title: 'Home', base_revision: 2 })).body.error.code).toBe('taken');
  });

  it('searches what readers may see', async () => {
    const hits = (await client(ctx.app).get('/api/v1/wiki/site/search?q=steps')).body.hits;
    expect(hits.map((h: { slug: string }) => h.slug)).toEqual(['first-steps']);
    expect(hits[0].snippet).toContain('\u0002Steps\u0003');
  });

  it('protects, hides and deletes for admins only, audited, and closes reports on the page', async () => {
    expect((await p('tess').c.post('/api/v1/wiki/site/pages/home/protect', {})).status).toBe(403);
    expect((await admin.client.post('/api/v1/wiki/site/pages/home/protect', {})).body.protected).toBe(true);
    expect((await save(p('tess').c, 'home', { title: 'Home', body: 'change', base_revision: 3 })).body.error.code).toBe('protected');
    expect((await save(admin.client, 'home', { title: 'Home', body: 'Welcome. See [[First Steps]].', base_revision: 3 })).body.revision).toBe(4);

    const rep = await p('ursula').c.post('/api/v1/wiki/site/pages/first-steps/report', { category: 'spam', note: 'ads' });
    expect(rep.status).toBe(201);
    const queue = (await admin.client.get('/api/v1/reports')).body.reports;
    expect(queue[0]).toMatchObject({ target: { type: 'wiki_page' }, wiki: { ref: 'site', slug: 'first-steps', title: 'First Steps' } });
    expect((await admin.client.post('/api/v1/wiki/site/pages/first-steps/hide', {})).status).toBe(400); // needs a reason
    expect((await admin.client.post('/api/v1/wiki/site/pages/first-steps/hide', { reason: 'spam links' })).body.hidden).toBe(true);
    expect((await page(p('ursula').c, 'first-steps')).status).toBe(404);
    expect((await db.query(`SELECT status FROM reports WHERE id = $1`, [rep.body.id])).rows[0]!.status).toBe('actioned');
    await admin.client.post('/api/v1/wiki/site/pages/first-steps/unhide', {});
    const actions = (await db.query(`SELECT action FROM audit_log WHERE target_type = 'wiki_page' ORDER BY id`)).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['wiki.page_protected', 'report.created', 'wiki.page_hidden', 'wiki.page_restored']));

    // A revision's text can be kept from view, but not the current one.
    expect((await admin.client.post('/api/v1/wiki/site/pages/home/revisions/4/hide', { reason: 'doxxing' })).body.error.code).toBe('current');
    expect((await admin.client.post('/api/v1/wiki/site/pages/home/revisions/2/hide', { reason: 'doxxing' })).status).toBe(204);
    expect((await p('ursula').c.get('/api/v1/wiki/site/pages/home/revisions/2')).body).toMatchObject({ body: null, text_hidden: true });
    expect((await admin.client.get('/api/v1/wiki/site/pages/home/revisions/2')).body.body).toContain('Welcome, all');
  });

  it('lets a ring’s ops switch its wiki on, and only its trusted members and ops edit it', async () => {
    expect((await p('tess').c.post('/api/v1/rings', { slug: 'synths', name: 'Synths' })).status).toBe(201);
    expect((await page(client(ctx.app), 'home', 'ring:synths')).status).toBe(404); // off until switched on
    expect((await p('tom').c.put('/api/v1/rings/synths/wiki', { enabled: true })).status).toBe(404); // an off wiki looks like none to non-ops
    expect((await p('tess').c.put('/api/v1/rings/synths/wiki', { enabled: true })).status).toBe(204);
    expect((await save(p('tess').c, 'patches', { title: 'Patches', body: 'Our favourite patches.', base_revision: 0 }, 'ring:synths')).status).toBe(200);
    expect((await save(p('tom').c, 'patches', { title: 'Patches', body: 'mine', base_revision: 1 }, 'ring:synths')).status).toBe(403); // trusted, but not a member
    await p('tom').c.post('/api/v1/rings/synths/join');
    expect((await save(p('tom').c, 'patches', { title: 'Patches', body: 'Our favourite patches, and mine.', base_revision: 1 }, 'ring:synths')).body.revision).toBe(2);
    expect((await page(client(ctx.app), 'patches', 'ring:synths')).body.title).toBe('Patches');
    expect((await page(client(ctx.app), 'patches')).status).toBe(404); // a ring's pages are its own
    expect((await db.query(`SELECT action FROM audit_log WHERE action = 'wiki.enabled'`)).rowCount).toBe(1);
  });

  it('puts someone’s revisions in their export, and erases or keeps them when they leave', async () => {
    const x = p('tom');
    expect((await x.c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const row = (await db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [x.id])).rows[0]!;
    const files = unzipSync(new Uint8Array(readFileSync(join(ctx.deps.exportsDir, `${row.id}.zip`))));
    const revs = JSON.parse(strFromU8(files['wiki/revisions.json']!));
    expect(revs.map((r: { wiki: string; page: string; revision: number }) => `${r.wiki}/${r.page}@${r.revision}`)).toEqual(['site/home@2', 'site/first-steps@2', 'ring:synths/patches@2']);

    // Tom erases his writing: his texts go, and the ring page he last edited goes back to Tess's version.
    expect((await x.c.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: 'tom', posts: 'erase' })).status).toBe(204);
    expect((await page(client(ctx.app), 'patches', 'ring:synths')).body).toMatchObject({ body: 'Our favourite patches.', updated_by: { handle: 'tess' } });
    const h = (await client(ctx.app).get('/api/v1/wiki/ring:synths/pages/patches/history')).body.revisions;
    expect(h[0]).toMatchObject({ revision: 2, editor: null });
    expect((await client(ctx.app).get('/api/v1/wiki/ring:synths/pages/patches/revisions/2')).body.body).toBe('[removed at the author’s request]');

    // Tess keeps hers: her revisions stay, credited to nobody. (She hands her ring on first, as anyone leaving must.)
    await p('tess').c.post('/api/v1/rings/synths/join').catch(() => undefined);
    const heir = await makeUser(ctx, { handle: 'heir', role: 'trusted' });
    const hc = await loginAs(ctx, heir.handle);
    await hc.post('/api/v1/rings/synths/join');
    expect((await p('tess').c.post('/api/v1/rings/synths/transfer', { handle: 'heir' })).status).toBeLessThan(300);
    expect((await p('tess').c.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: 'tess', posts: 'keep' })).status).toBe(204);
    const kept = (await client(ctx.app).get('/api/v1/wiki/site/pages/home/revisions/1')).body;
    expect(kept).toMatchObject({ editor: null });
    expect(kept.body).toContain('Welcome.');
  });
});
