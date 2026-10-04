import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { syncCatalog } from './apps';
import { processNext } from './exports/service';
import { buildHomesApp } from './homes/server';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, ORIGIN, TEST_PASSWORD } from './test/harness';

// Installable apps (docs/10, docs/15): the catalog follows the apps folder, people add and remove apps, an app
// keeps data only through these routes and only within its limits, and everything it kept is the person's.
const ICON = 'M4 4h16v16H4z';
function pack(dir: string, id: string, manifest: Record<string, unknown>, files: Record<string, string> = { 'index.html': '<!doctype html><title>x</title>' }) {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, 'manifest.json'), JSON.stringify({ id, name: id, version: '1.0.0', description: `The ${id} app.`, icon: ICON, ...manifest }));
  for (const [name, body] of Object.entries(files)) { mkdirSync(join(dir, id, name, '..'), { recursive: true }); writeFileSync(join(dir, id, name), body); }
}

describe.skipIf(!dbAvailable)('installable apps', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let dir: string;
  let alice: { id: string; handle: string; c: ReturnType<typeof client> };
  let bob: { id: string; handle: string; c: ReturnType<typeof client> };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    dir = mkdtempSync(join(tmpdir(), 'apps-test-'));
    pack(dir, 'todo', { name: 'Todo', permissions: ['storage'] }, { 'index.html': '<!doctype html><title>Todo</title>', 'assets/app.js': 'console.log(1)', '.secret': 'no' });
    pack(dir, 'clock', { name: 'Clock' });
    pack(dir, 'broken', { version: 'one' });
    ctx = await makeApp(db, { appsDir: dir });
    await syncCatalog(ctx.deps);
    const a = await makeUser(ctx); alice = { ...a, c: await loginAs(ctx, a.handle) };
    const b = await makeUser(ctx); bob = { ...b, c: await loginAs(ctx, b.handle) };
  });
  afterAll(async () => drop());

  it('offers the packages in the apps folder, skipping a bad manifest, and only to signed-in people', async () => {
    const r = await alice.c.get('/api/v1/apps');
    expect(r.status).toBe(200);
    expect(r.body.apps.map((x: { id: string }) => x.id)).toEqual(['clock', 'todo']);
    expect(r.body.apps[1]).toMatchObject({ name: 'Todo', permissions: ['storage'], installed: false, url: 'https://example-homes.test/apps/todo@1.0.0/index.html' });
    expect((await client(ctx.app).get('/api/v1/apps')).status).toBe(401);
  });

  it('adds and removes apps per person', async () => {
    expect((await alice.c.put('/api/v1/me/apps/todo')).status).toBe(200);
    expect((await alice.c.put('/api/v1/me/apps/todo')).status).toBe(200); // twice is fine
    expect((await alice.c.get('/api/v1/me/apps')).body.apps.map((x: { id: string }) => x.id)).toEqual(['todo']);
    expect((await bob.c.get('/api/v1/me/apps')).body.apps).toEqual([]);
    expect((await alice.c.put('/api/v1/me/apps/broken')).status).toBe(404);
    expect((await alice.c.put('/api/v1/me/apps/nope')).status).toBe(404);
    expect((await alice.c.put('/api/v1/me/apps/Bad!')).status).toBe(400);
  });

  it('keeps an app\'s data only while it is added, only if it asked, and only its own', async () => {
    const put = (c: typeof alice.c, app: string, doc: string, data: unknown) => c.put(`/api/v1/me/apps/${app}/data/items/${doc}`, { data });
    expect((await put(alice.c, 'todo', 'i1', { text: 'Buy milk', done: false })).status).toBe(200);
    expect((await put(alice.c, 'todo', 'i2', { text: 'Call Sam', done: true })).status).toBe(200);
    expect((await alice.c.get('/api/v1/me/apps/todo/data/items')).body.docs.map((d: { id: string; data: { text: string } }) => [d.id, d.data.text])).toEqual([['i1', 'Buy milk'], ['i2', 'Call Sam']]);
    // Bob hasn't added it, and can't see Alice's.
    expect((await put(bob.c, 'todo', 'i1', { text: 'x' })).body.error.code).toBe('not_installed');
    expect((await bob.c.get('/api/v1/me/apps/todo/data/items')).status).toBe(403);
    // An app that didn't ask for storage gets none.
    await alice.c.put('/api/v1/me/apps/clock');
    expect((await put(alice.c, 'clock', 'x', 1)).body.error.code).toBe('not_permitted');
    // Bad names and empty writes.
    expect((await alice.c.put('/api/v1/me/apps/todo/data/Items/i1', { data: 1 })).status).toBe(400);
    expect((await alice.c.put('/api/v1/me/apps/todo/data/items/i3', {})).status).toBe(400);
    // Deleting one.
    expect((await alice.c.delete('/api/v1/me/apps/todo/data/items/i2')).status).toBe(204);
    expect((await alice.c.get('/api/v1/me/apps/todo/data/items')).body.docs).toHaveLength(1);
  });

  it('refuses a piece over 64 KB and stops an app at 5 MB per person', async () => {
    const big = 'x'.repeat(65 * 1024);
    expect((await alice.c.put('/api/v1/me/apps/todo/data/items/big', { data: big })).status).toBe(413);
    await db.query(`INSERT INTO app_data (user_id, app_id, collection, doc_id, data, bytes) VALUES ($1, 'todo', 'filler', 'f', '0', $2)`, [alice.id, 5 * 1024 * 1024 - 10]);
    expect((await alice.c.put('/api/v1/me/apps/todo/data/items/more', { data: 'twenty characters!!' })).body.error.code).toBe('too_large');
    await db.query(`DELETE FROM app_data WHERE user_id = $1 AND collection = 'filler'`, [alice.id]);
  });

  it('removing an app keeps its data, adding it again brings it back, and deleting the data is separate', async () => {
    expect((await alice.c.delete('/api/v1/me/apps/todo')).status).toBe(204);
    expect((await alice.c.get('/api/v1/me/apps/todo/data/items')).status).toBe(403);
    const listed = (await alice.c.get('/api/v1/apps')).body.apps.find((x: { id: string }) => x.id === 'todo');
    expect(listed).toMatchObject({ installed: false, has_data: true });
    await alice.c.put('/api/v1/me/apps/todo');
    expect((await alice.c.get('/api/v1/me/apps/todo/data/items')).body.docs).toHaveLength(1);
  });

  it('an admin withdraws and offers an app, audited; a withdrawn app is hidden and its data routes close', async () => {
    const admin = await makeAdmin(ctx);
    expect((await alice.c.put('/api/v1/admin/apps/todo', { offered: false })).status).toBe(403);
    const list = (await admin.client.get('/api/v1/admin/apps')).body.apps;
    expect(list.find((x: { id: string }) => x.id === 'todo')).toMatchObject({ people: 1, offered: true, present: true });
    expect((await admin.client.put('/api/v1/admin/apps/todo', { offered: false })).status).toBe(204);
    expect((await alice.c.get('/api/v1/apps')).body.apps.map((x: { id: string }) => x.id)).toEqual(['clock']);
    expect((await alice.c.get('/api/v1/me/apps')).body.apps.map((x: { id: string }) => x.id)).toEqual(['clock']);
    expect((await alice.c.get('/api/v1/me/apps/todo/data/items')).status).toBe(404);
    expect((await admin.client.put('/api/v1/admin/apps/todo', { offered: true })).status).toBe(204);
    const actions = (await db.query<{ action: string }>(`SELECT action FROM audit_log WHERE target_type = 'app' AND target_id = 'todo' ORDER BY id`)).rows.map((r) => r.action);
    expect(actions).toEqual(['app.withdrawn', 'app.offered']);
  });

  it('a package that leaves the folder is hidden, not forgotten', async () => {
    const other = mkdtempSync(join(tmpdir(), 'apps-test-'));
    pack(other, 'todo', { name: 'Todo', version: '1.1.0', permissions: ['storage'] });
    await syncCatalog({ ...ctx.deps, appsDir: other });
    expect((await alice.c.get('/api/v1/apps')).body.apps.map((x: { id: string; version: string }) => `${x.id}@${x.version}`)).toEqual(['todo@1.1.0']);
    await syncCatalog(ctx.deps);
    expect((await alice.c.get('/api/v1/apps')).body.apps.map((x: { id: string }) => x.id)).toEqual(['clock', 'todo']);
  });

  it('the homes server serves an offered app with its sandbox policy, and nothing else', async () => {
    const homes = await buildHomesApp(ctx.deps);
    const get = (url: string) => homes.inject({ method: 'GET', url, headers: { host: 'example-homes.test' } });
    const page = await get('/apps/todo@1.0.0/index.html');
    expect(page.statusCode).toBe(200);
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toContain('sandbox allow-scripts allow-forms');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain(`frame-ancestors ${new URL(ORIGIN).origin}`);
    expect(page.headers['access-control-allow-origin']).toBe('*');
    expect((await get('/apps/todo@1.0.0/assets/app.js')).statusCode).toBe(200);
    expect((await get('/apps/todo@9.9.9/index.html')).statusCode).toBe(404);     // not the current version
    expect((await get('/apps/todo@1.0.0/.secret')).statusCode).toBe(404);        // no dot files
    expect((await get('/apps/todo@1.0.0/../clock/index.html')).statusCode).toBe(404);
    expect((await get('/apps/broken@1.0.0/index.html')).statusCode).toBe(404);   // not in the catalog
    await db.query(`UPDATE app_catalog SET offered = false WHERE app_id = 'clock'`);
    expect((await get('/apps/clock@1.0.0/index.html')).statusCode).toBe(404);    // withdrawn
    await db.query(`UPDATE app_catalog SET offered = true WHERE app_id = 'clock'`);
    await homes.close();
  });

  it('what apps kept is in the export, comes back on import, and goes with the account', async () => {
    expect((await alice.c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [alice.id])).rows[0]!;
    const zip = readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`));
    const files = unzipSync(new Uint8Array(zip));
    expect(JSON.parse(strFromU8(files['apps/installed.json']!))).toEqual(['clock', 'todo']);
    expect(JSON.parse(strFromU8(files['apps/todo/items.json']!)).map((d: { id: string; data: { text: string } }) => d.data.text)).toEqual(['Buy milk']);

    // She loses them, then brings them back.
    await alice.c.delete('/api/v1/me/apps/todo/data');
    await alice.c.delete('/api/v1/me/apps/todo');
    const up = await ctx.app.inject({ method: 'POST', url: '/api/v1/me/import', payload: zip, headers: { origin: ORIGIN, cookie: `sid=${alice.c.sid}`, 'content-type': 'application/octet-stream' } });
    expect(up.statusCode).toBe(200);
    expect(up.json().parts.find((p: { part: string }) => p.part === 'apps')).toMatchObject({ count: 1, issues: [] });
    const applied = await alice.c.post(`/api/v1/me/import/${up.json().id}/apply`, { password: TEST_PASSWORD, parts: ['apps'] });
    expect(applied.status).toBe(200);
    expect(applied.body.parts).toEqual([{ part: 'apps', restored: 1, issues: [] }]);
    expect((await alice.c.get('/api/v1/me/apps/todo/data/items')).body.docs[0].data.text).toBe('Buy milk');

    expect((await alice.c.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: alice.handle, posts: 'keep' })).status).toBeLessThan(300);
    for (const t of ['app_data', 'app_installs']) expect((await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [alice.id])).rows[0]!.n, t).toBe(0);
  });
});
