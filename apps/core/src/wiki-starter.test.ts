import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWiki, wikiSlug } from '@app/shared';
import { parseSiteConfig } from './config';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, SITE_YAML } from './test/harness';
import { adminByHandle, addStarterPages, starterPages } from './wiki-starter';

const testConfig = () => parseSiteConfig(SITE_YAML());

describe('the wiki starter pages, as text', () => {
  it('are filled in from the site config and link to each other', async () => {
    const ctx = { config: testConfig() };
    const pages = starterPages(ctx.config);
    expect(pages.map((p) => p.title)).toEqual(['Home', 'Getting started', 'Connecting', 'Rings', 'Your stuff', 'Privacy and safety']);
    expect(pages[0]!.body).toContain(ctx.config.site.name);
    const titles = new Set(pages.map((p) => wikiSlug(p.title)));
    for (const p of pages) {
      for (const [, target] of p.body.matchAll(/\[\[([^\]|]+)/g)) expect(titles.has(wikiSlug(target!)), `${p.title} links to ${target}`).toBe(true);
      expect(parseWiki(p.body).length).toBeGreaterThan(1);
    }
  });
  it('only describe the ways in that are switched on', async () => {
    const off = testConfig();
    off.services = { bbs: false, irc: false, mud: false, gopher: false, finger: false, gemini: false };
    const connecting = starterPages(off).find((p) => p.title === 'Connecting')!.body;
    for (const word of ['telnet', 'IRC', 'MUD', 'gopher://', 'gemini://', 'finger', 'terminal password']) expect(connecting, word).not.toContain(word);
    const on = testConfig();
    on.services = { bbs: true, irc: true, mud: true, gopher: true, finger: true, gemini: true };
    const all = starterPages(on).find((p) => p.title === 'Connecting')!.body;
    for (const word of ['ssh -p', 'SASL', 'connect yourhandle', 'gopher://', 'gemini://', 'finger yourhandle@']) expect(all, word).toContain(word);
  });
});

describe.skipIf(!dbAvailable)('adding the wiki starter pages', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  it('is for admins only, adds what is missing, keeps what is there, and is audited', async () => {
    const trusted = await loginAs(ctx, (await makeUser(ctx, { role: 'trusted' })).handle);
    expect((await trusted.post('/api/v1/wiki/site/starter', {})).status).toBe(403);
    // Someone already wrote their own Rings page: it stays as they wrote it.
    await trusted.put('/api/v1/wiki/site/pages/rings', { title: 'Rings', body: 'Our own words about rings.', base_revision: 0, summary: '' });
    const admin = await makeAdmin(ctx);
    const r = await admin.client.post('/api/v1/wiki/site/starter', {});
    expect(r.status).toBe(200);
    expect(r.body.added).toEqual(['Home', 'Getting started', 'Connecting', 'Your stuff', 'Privacy and safety']);
    expect((await trusted.get('/api/v1/wiki/site/pages/rings')).body.body).toBe('Our own words about rings.');
    const home = (await trusted.get('/api/v1/wiki/site/pages/home')).body;
    expect(home.body).toContain(ctx.deps.config.site.name);
    // Credited to the admin, with ordinary history.
    const hist = (await trusted.get('/api/v1/wiki/site/pages/home/history')).body;
    expect(JSON.stringify(hist)).toContain(admin.handle);
    const logged = await ctx.deps.db.query(`SELECT after FROM audit_log WHERE action = 'wiki.starter_added'`);
    expect(logged.rows[0]!.after.pages).toHaveLength(5);
    // From the CLI, as the same admin: nothing left to add.
    expect(await addStarterPages(ctx.deps, await adminByHandle(ctx.deps, admin.handle), 'cli')).toEqual([]);
    await expect(adminByHandle(ctx.deps, (await makeUser(ctx)).handle)).rejects.toThrow(/not an admin/);
  });
});
