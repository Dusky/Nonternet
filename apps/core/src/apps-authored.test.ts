import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { compareVersions, readPackage, submittedDir } from './apps-authored';
import { processNext } from './exports/service';
import { buildHomesApp } from './homes/server';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';

// Apps made by trusted people (docs/10, 15, 17 2026-10-18): send, try privately, review, offer, report, withdraw.
const ICON = 'M4 4h16v16H4z';
const manifest = (over: Record<string, unknown> = {}) => ({ id: 'dice', name: 'Dice', version: '1.0.0', description: 'Rolls dice.', icon: ICON, permissions: ['storage'], ...over });
const zip = (m: Record<string, unknown>, files: Record<string, string> = { 'index.html': '<!doctype html><title>Dice</title>', 'app.js': 'roll()' }, top = '') =>
  Buffer.from(zipSync(Object.fromEntries([['manifest.json', JSON.stringify(m)], ...Object.entries(files)].map(([k, v]) => [`${top}${k}`, strToU8(v!)]))));
const Z = { 'content-type': 'application/zip' };

describe('readPackage', () => {
  it('reads a zip, also one with a single folder at the top', () => {
    expect(readPackage(zip(manifest())).manifest.id).toBe('dice');
    expect([...readPackage(zip(manifest(), undefined, 'dice/')).files.keys()].sort()).toEqual(['app.js', 'index.html', 'manifest.json']);
  });
  it('refuses hidden files, climbing paths, unknown kinds of file, a missing entry page and a bad manifest', () => {
    expect(() => readPackage(zip(manifest(), { 'index.html': 'x', '.env': 'secret' }))).toThrow(/hidden/);
    expect(() => readPackage(zip(manifest(), { 'index.html': 'x', 'a/../../b.js': 'x' }))).toThrow(/\.\./);
    expect(() => readPackage(zip(manifest(), { 'index.html': 'x', 'run.sh': 'x' }))).toThrow(/\.sh files/);
    expect(() => readPackage(zip(manifest(), { 'other.html': 'x' }))).toThrow(/entry page/);
    expect(() => readPackage(zip(manifest({ widget: 'w.html' })))).toThrow(/widget page/);
    expect(() => readPackage(zip(manifest({ version: 'one' })))).toThrow(/manifest.json: version/);
    expect(() => readPackage(Buffer.from('not a zip'))).toThrow(/not a zip/);
  });
  it('compares versions by number', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});

describe.skipIf(!dbAvailable)('apps made by trusted people', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let boss: Awaited<ReturnType<typeof makeAdmin>>;
  let maker: { id: string; handle: string; c: Awaited<ReturnType<typeof loginAs>> };
  let other: { id: string; handle: string; c: Awaited<ReturnType<typeof loginAs>> };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    boss = await makeAdmin(ctx, 'appboss');
    const m = await makeUser(ctx, { role: 'trusted' }); maker = { ...m, c: await loginAs(ctx, m.handle) };
    const o = await makeUser(ctx); other = { ...o, c: await loginAs(ctx, o.handle) };
  });
  afterAll(async () => drop());

  const homes = async () => {
    const h = await buildHomesApp(ctx.deps);
    return { get: (url: string) => h.inject({ method: 'GET', url, headers: { host: 'example-homes.test' } }), close: () => h.close() };
  };

  it('only trusted people can send an app', async () => {
    expect((await other.c.post('/api/v1/me/apps-authored', zip(manifest()), Z)).status).toBe(403);
  });

  it('a sent app is private to its author, who can add and use it, until an admin approves it', async () => {
    const sent = await maker.c.post('/api/v1/me/apps-authored', zip(manifest()), Z);
    expect(sent.status).toBe(201);
    expect(sent.body.app).toMatchObject({ id: 'dice', offered: false, live_version: null, versions: [{ version: '1.0.0', status: 'pending' }] });
    expect(existsSync(join(submittedDir(ctx.deps, 'dice', '1.0.0'), 'app.js'))).toBe(true);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'app.submitted' AND target_id = 'dice'`)).rows).toHaveLength(1);

    // Nobody else sees it or can add it.
    expect((await other.c.get('/api/v1/apps')).body.apps.map((a: { id: string }) => a.id)).not.toContain('dice');
    expect((await other.c.put('/api/v1/me/apps/dice')).status).toBe(404);
    // Its author can try it, data and all.
    expect((await maker.c.put('/api/v1/me/apps/dice')).status).toBe(200);
    const mine = (await maker.c.get('/api/v1/me/apps')).body.apps;
    expect(mine).toEqual([expect.objectContaining({ id: 'dice', testing: true, author: maker.handle, url: 'https://example-homes.test/apps/dice@1.0.0/index.html' })]);
    expect((await maker.c.put('/api/v1/me/apps/dice/data/rolls/r1', { data: { n: 6 } })).status).toBe(200);
    // The homes server serves the waiting version (sandboxed as always).
    const h = await homes();
    const page = await h.get('/apps/dice@1.0.0/index.html');
    expect(page.statusCode).toBe(200);
    expect(String(page.headers['content-security-policy'])).toContain("connect-src 'none'");
    await h.close();

    // Someone else's id, or the site's own, is taken.
    const third = await makeUser(ctx, { role: 'trusted' });
    expect((await (await loginAs(ctx, third.handle)).post('/api/v1/me/apps-authored', zip(manifest()), Z)).body.error.code).toBe('app_id_taken');
  });

  it('an admin sees it waiting and approves it; then everyone can add it, with the author named', async () => {
    const q = (await boss.client.get('/api/v1/admin/app-reviews')).body.reviews;
    expect(q).toEqual([expect.objectContaining({ id: 'dice', version: '1.0.0', author: maker.handle, permissions: ['storage'], live_version: null })]);
    expect(q[0].files.map((f: { path: string }) => f.path)).toEqual(['app.js', 'index.html', 'manifest.json']);
    expect((await other.c.get('/api/v1/admin/app-reviews')).status).toBe(403);
    expect((await boss.client.post('/api/v1/admin/app-reviews/dice/1.0.0', { decision: 'approve' })).status).toBe(204);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'app.approved' AND target_id = 'dice'`)).rows).toHaveLength(1);
    const cat = (await other.c.get('/api/v1/apps')).body.apps.find((a: { id: string }) => a.id === 'dice');
    expect(cat).toMatchObject({ author: maker.handle, version: '1.0.0' });
    expect((await other.c.put('/api/v1/me/apps/dice')).status).toBe(200);
  });

  it('a new version waits for review while the approved one stays live; a declined one says why', async () => {
    expect((await maker.c.post('/api/v1/me/apps-authored', zip(manifest()), Z)).body.error.code).toBe('version_not_newer');
    expect((await maker.c.post('/api/v1/me/apps-authored', zip(manifest({ version: '1.1.0', permissions: ['storage', 'notify'] })), Z)).status).toBe(201);
    // Everyone else still gets 1.0.0; the author tries 1.1.0.
    expect((await other.c.get('/api/v1/me/apps')).body.apps.find((a: { id: string }) => a.id === 'dice').version).toBe('1.0.0');
    expect((await maker.c.get('/api/v1/me/apps')).body.apps.find((a: { id: string }) => a.id === 'dice').version).toBe('1.1.0');
    expect((await boss.client.post('/api/v1/admin/app-reviews/dice/1.1.0', { decision: 'decline' })).body.error.code).toBe('reason_required');
    expect((await boss.client.post('/api/v1/admin/app-reviews/dice/1.1.0', { decision: 'decline', reason: 'It asks to notify but never does.' })).status).toBe(204);
    const mine = (await maker.c.get('/api/v1/me/apps-authored')).body.apps[0];
    expect(mine.versions[0]).toMatchObject({ version: '1.1.0', status: 'declined', reason: 'It asks to notify but never does.' });
    expect(mine.live_version).toBe('1.0.0');
    expect(existsSync(submittedDir(ctx.deps, 'dice', '1.1.0'))).toBe(false);
    const h = await homes();
    expect((await h.get('/apps/dice@1.1.0/index.html')).statusCode).toBe(404);
    expect((await h.get('/apps/dice@1.0.0/index.html')).statusCode).toBe(200);
    await h.close();
    // 1.2.0 is approved and replaces 1.0.0 for everyone.
    await maker.c.post('/api/v1/me/apps-authored', zip(manifest({ version: '1.2.0' })), Z);
    await boss.client.post('/api/v1/admin/app-reviews/dice/1.2.0', { decision: 'approve' });
    expect((await other.c.get('/api/v1/me/apps')).body.apps.find((a: { id: string }) => a.id === 'dice').version).toBe('1.2.0');
  });

  it('people can report it; withdrawing it closes the reports and keeps what people kept', async () => {
    const rep = await other.c.post('/api/v1/apps/dice/report', { category: 'spam', note: 'Ads everywhere' });
    expect(rep.status).toBe(201);
    expect((await maker.c.post('/api/v1/apps/dice/report', { category: 'spam' })).body.error.code).toBe('own_app');
    const reports = (await boss.client.get('/api/v1/reports')).body.reports;
    expect(reports.find((r: { target: { type: string } }) => r.target.type === 'app')).toMatchObject({ target: { id: 'dice', handle: maker.handle }, excerpt: 'Dice — Rolls dice.' });
    expect((await boss.client.put('/api/v1/admin/apps/dice', { offered: false })).status).toBe(204);
    expect((await db.query(`SELECT status FROM reports WHERE id = $1`, [rep.body.id])).rows[0]).toEqual({ status: 'actioned' });
    expect((await other.c.get('/api/v1/me/apps')).body.apps.map((a: { id: string }) => a.id)).not.toContain('dice');
    expect((await db.query(`SELECT count(*)::int AS n FROM app_data WHERE app_id = 'dice'`)).rows[0]).toEqual({ n: 1 });
    await boss.client.put('/api/v1/admin/apps/dice', { offered: true });
  });

  it('the author can take it back; their apps are in their export and are withdrawn with their account', async () => {
    expect((await maker.c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [maker.id])).rows[0]!;
    const files = unzipSync(readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`)));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['apps-authored/versions.json', 'apps-authored/dice/1.2.0/index.html', 'apps-authored/dice/1.0.0/app.js']));

    expect((await other.c.delete('/api/v1/me/apps-authored/dice')).status).toBe(404);
    expect((await maker.c.delete('/api/v1/me/apps-authored/dice')).status).toBe(204);
    expect((await other.c.get('/api/v1/apps')).body.apps.map((a: { id: string }) => a.id)).not.toContain('dice');

    await boss.client.put('/api/v1/admin/apps/dice', { offered: true });
    await maker.c.post('/api/v1/me/apps-authored', zip(manifest({ version: '2.0.0' })), Z);
    expect((await boss.client.post(`/api/v1/admin/users/${maker.id}/delete`, { reason: 'Asked by email', posts: 'keep' })).status).toBe(204);
    expect((await db.query(`SELECT offered FROM app_catalog WHERE app_id = 'dice'`)).rows[0]).toEqual({ offered: false });
    expect((await db.query(`SELECT status FROM app_versions WHERE app_id = 'dice' AND version = '2.0.0'`)).rows[0]).toEqual({ status: 'withdrawn' });
  });
});
