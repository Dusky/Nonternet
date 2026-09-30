import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBackupKey, restoreTest, runBackup } from './backup';
import { client, createTestDb, dbAvailable, first, loginAs, makeApp, makeUser } from './test/harness';

const haveTools = (() => { try { execFileSync('pg_dump', ['--version']); execFileSync('tar', ['--version']); return true; } catch { return false; } })();

describe('the backup key', () => {
  it('must be 32 bytes of base64', () => {
    expect(() => parseBackupKey(undefined)).toThrow(/BACKUP_KEY is required/);
    expect(() => parseBackupKey('c2hvcnQ=')).toThrow(/32 bytes/);
    expect(parseBackupKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });
});

describe.skipIf(!dbAvailable || !haveTools)('backup and restore test', { timeout: 120_000 }, () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let url: string;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  const dir = mkdtempSync(join(tmpdir(), 'backups-'));
  const key = randomBytes(32);
  let cfgFile: string;
  const opts = () => ({ dir, key, databaseUrl: url, configFile: cfgFile });

  beforeAll(async () => {
    ({ db, drop, url } = await createTestDb());
    ctx = await makeApp(db);
    cfgFile = join(dir, 'site.yaml');
    writeFileSync(cfgFile, 'site: { name: Secret Name Here }\n');
    const alice = await makeUser(ctx, { role: 'trusted', handle: 'zorbaxplume' });
    const c = await loginAs(ctx, alice.handle);
    await c.post('/api/v1/boards', { slug: 'general', name: 'General', visibility: 'public' });
    await c.post('/api/v1/boards/general/posts', { subject: 'A thread', body: 'quokkaquokka is a secret word' });
    await ctx.app.inject({ method: 'PUT', url: '/api/v1/homes/me/file?path=index.html', payload: '<h1>platypus-page</h1>', headers: { origin: 'https://example.test', cookie: `sid=${c.sid}`, 'content-type': 'application/octet-stream' } });
  });
  afterAll(async () => drop());

  it('writes three encrypted files and a manifest, and none of it is readable without the key', async () => {
    const r = await runBackup(ctx.deps, opts());
    const files = readdirSync(dir).sort();
    expect(files.filter((f) => f.endsWith('.enc'))).toHaveLength(3);
    for (const f of files.filter((n) => n.endsWith('.enc'))) {
      const bytes = readFileSync(join(dir, f)).toString('latin1');
      for (const secret of ['zorbaxplume', 'quokkaquokka', 'platypus-page', 'Secret Name Here', 'PGDMP']) expect(bytes, `${f} leaks ${secret}`).not.toContain(secret);
    }
    const m = JSON.parse(readFileSync(join(dir, r.manifest), 'utf8'));
    expect(m).toMatchObject({ format: 'backup-v1', counts: { users: 1, posts: 1, boards: 1, homepages: 1 }, homepage_files: 1 });
    expect(Object.keys(m.files).sort()).toEqual(['config', 'db', 'homes']);
    expect(first(await db.query(`SELECT status, location FROM backup_runs WHERE kind = 'backup'`))).toMatchObject({ status: 'ok', location: r.manifest });
  });

  it('restores the newest backup into a scratch database, checks it and cleans up', async () => {
    const r = await restoreTest(ctx.deps, opts());
    expect(r.ok, JSON.stringify(r.checks.filter((c) => !c.ok))).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(expect.arrayContaining(['db file is intact', 'users restored', 'posts restored', 'homepage files restored']));
    const run = first(await db.query(`SELECT status, detail FROM backup_runs WHERE kind = 'restore_test' ORDER BY started_at DESC LIMIT 1`));
    expect(run.status).toBe('ok');
    const left = await db.query(`SELECT datname FROM pg_database WHERE datname LIKE 'restore_test_%'`);
    expect(left.rows).toEqual([]);
  });

  it('fails, and says why, when the data no longer matches the manifest', async () => {
    // A backup taken now, then a post is added that the backup does not have: the manifest is honest, so still ok...
    const before = await restoreTest(ctx.deps, opts());
    expect(before.ok).toBe(true);
    // ...but a manifest that overstates what was backed up is caught.
    const newest = readdirSync(dir).filter((f) => f.endsWith('-manifest.json')).sort().at(-1)!;
    const m = JSON.parse(readFileSync(join(dir, newest), 'utf8'));
    m.counts.posts = 99;
    writeFileSync(join(dir, newest), JSON.stringify(m));
    const r = await restoreTest(ctx.deps, opts());
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => !c.ok)).toMatchObject({ name: 'posts restored', expected: 99, actual: 1 });
    expect(first(await db.query(`SELECT status, error FROM backup_runs WHERE kind = 'restore_test' ORDER BY started_at DESC LIMIT 1`))).toMatchObject({ status: 'failed', error: '1 check(s) failed' });
  });

  it('notices a damaged file before trying to restore it', async () => {
    await runBackup(ctx.deps, opts()); // a fresh, good one first
    const newest = readdirSync(dir).filter((f) => f.endsWith('-manifest.json')).sort().at(-1)!;
    const m = JSON.parse(readFileSync(join(dir, newest), 'utf8'));
    appendFileSync(join(dir, m.files.db.name), 'x');
    const r = await restoreTest(ctx.deps, opts());
    expect(r.ok).toBe(false);
    expect(r.checks[0]).toMatchObject({ name: 'db file is intact', ok: false });
    expect(first(await db.query(`SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'restore_test_%'`)).n).toBe(0); // nothing was restored
  });

  it('fails with the wrong key, and with no backup at all', async () => {
    await runBackup(ctx.deps, opts());
    const wrong = await restoreTest(ctx.deps, { ...opts(), key: randomBytes(32) });
    expect(wrong.ok).toBe(false);
    expect(first(await db.query(`SELECT error FROM backup_runs WHERE kind = 'restore_test' ORDER BY started_at DESC LIMIT 1`)).error).toMatch(/authenticate|Unsupported/i);
    const empty = mkdtempSync(join(tmpdir(), 'nobackups-'));
    expect((await restoreTest(ctx.deps, { ...opts(), dir: empty })).ok).toBe(false);
    expect(first(await db.query(`SELECT error FROM backup_runs WHERE kind = 'restore_test' ORDER BY started_at DESC LIMIT 1`)).error).toContain('No backup found');
  });

  it('records a failed backup and stops', async () => {
    await expect(runBackup(ctx.deps, { ...opts(), databaseUrl: 'postgres://postgres@localhost:1/nope' })).rejects.toThrow(/pg_dump failed/);
    expect(first(await db.query(`SELECT status, error FROM backup_runs WHERE kind = 'backup' ORDER BY started_at DESC LIMIT 1`))).toMatchObject({ status: 'failed', error: expect.stringContaining('pg_dump failed') });
  });
});
