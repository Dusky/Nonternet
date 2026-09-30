import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { newId } from './crypto';
import type { AppDeps } from './deps';

// Backups and restore tests (docs/15), run by the operator with `cli backup` and `cli restore-test`.
// A backup is a few files in a directory: the database (pg_dump, custom format), the homepage
// files and the file-area uploads (tar), and the site config, each encrypted with BACKUP_KEY, and a manifest that records the
// hash of each file and what was counted. A restore test proves the newest backup can be brought
// back: it checks the hashes, restores into a scratch database, compares the counts, and
// records the result for the console. Copying the directory off the machine (and keeping
// APP_SECRET_KEY somewhere safe, apart from it) is the operator's job.
const MAGIC = Buffer.from('BK1');
const COUNTED = ['users', 'posts', 'boards', 'rings', 'homepages', 'guestbook_entries', 'exports', 'audit_log', 'files'] as const;

export function parseBackupKey(value: string | undefined): Buffer {
  if (!value) throw new Error('BACKUP_KEY is required: 32 random bytes, base64 (openssl rand -base64 32). Keep it apart from the backups.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_KEY must decode to exactly 32 bytes');
  return key;
}

// AES-256-GCM over a stream: a header (magic and a fresh IV), the ciphertext, then the 16-byte tag.
function encryptor(key: Buffer): Transform {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let started = false;
  return new Transform({
    transform(chunk, _enc, cb) { if (!started) { started = true; this.push(Buffer.concat([MAGIC, iv])); } cb(null, cipher.update(chunk)); },
    flush(cb) { if (!started) this.push(Buffer.concat([MAGIC, iv])); this.push(cipher.final()); this.push(cipher.getAuthTag()); cb(); },
  });
}

async function decryptTo(file: string, key: Buffer, out: NodeJS.WritableStream | string): Promise<void> {
  const size = (await fs.stat(file)).size;
  if (size < 31) throw new Error(`${file} is too short to be a backup`);
  const fd = await fs.open(file, 'r');
  const head = Buffer.alloc(15);
  const tag = Buffer.alloc(16);
  await fd.read(head, 0, 15, 0);
  await fd.read(tag, 0, 16, size - 16);
  await fd.close();
  if (!head.subarray(0, 3).equals(MAGIC)) throw new Error(`${file} is not an encrypted backup`);
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(3));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(file, { start: 15, end: size - 17 }), decipher, typeof out === 'string' ? createWriteStream(out) : out);
}

async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function encryptedFrom(cmd: string, args: string[], target: string, key: Buffer): Promise<void> {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const exit = new Promise<void>((resolve, reject) => child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${stderr.trim().slice(0, 300)}`)))));
  await Promise.all([pipeline(child.stdout, encryptor(key), createWriteStream(target)), exit]);
}

async function counts(db: { query: (sql: string) => Promise<{ rows: { n: string }[] }> }): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of COUNTED) out[t] = Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0]!.n);
  out.migrations = Number((await db.query(`SELECT count(*) AS n FROM schema_migrations`)).rows[0]!.n);
  return out;
}

const countHomeFiles = async (dir: string): Promise<number> => {
  let n = 0;
  const walk = async (d: string) => { for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) { if (e.isDirectory()) await walk(join(d, e.name)); else if (e.isFile()) n++; } };
  await walk(dir);
  return n;
};

export interface BackupOptions { dir: string; key: Buffer; databaseUrl: string; mudDatabaseUrl?: string; ircHistoryDatabaseUrl?: string; configFile?: string; log?: (m: string) => void }

// The MUD's world lives in its own database (docs/09, 15); these tables show it came back whole.
const MUD_COUNTED = ['accounts_accountdb', 'objects_objectdb', 'typeclasses_attribute'] as const;
async function mudCounts(url: string): Promise<Record<string, number>> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const out: Record<string, number> = {};
    for (const t of MUD_COUNTED) out[t] = Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${t}`)).rows[0]!.n);
    return out;
  } finally { await c.end(); }
}

export async function runBackup(deps: AppDeps, o: BackupOptions): Promise<{ manifest: string }> {
  const id = newId('bk');
  await deps.db.query(`INSERT INTO backup_runs (id, kind) VALUES ($1, 'backup')`, [id]);
  try {
    await fs.mkdir(o.dir, { recursive: true });
    const stamp = new Date(deps.now()).toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
    const files: Record<string, string> = { db: `${stamp}-db.dump.enc`, homes: `${stamp}-homes.tar.enc`, files: `${stamp}-files.tar.enc`, config: `${stamp}-config.yaml.enc` };
    o.log?.('dumping the database');
    await encryptedFrom('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--dbname', o.databaseUrl], join(o.dir, files.db!), o.key);
    if (o.mudDatabaseUrl) {
      files.mud = `${stamp}-mud.dump.enc`;
      o.log?.('dumping the MUD world');
      await encryptedFrom('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--dbname', o.mudDatabaseUrl], join(o.dir, files.mud), o.key);
    }
    if (o.ircHistoryDatabaseUrl) {
      files.irc = `${stamp}-irc-history.dump.enc`;
      o.log?.('dumping the chat history');
      await encryptedFrom('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--dbname', o.ircHistoryDatabaseUrl], join(o.dir, files.irc), o.key);
    }
    o.log?.('packing homepage files');
    await fs.mkdir(deps.homes.root, { recursive: true });
    await encryptedFrom('tar', ['-C', deps.homes.root, '-cf', '-', '.'], join(o.dir, files.homes!), o.key);
    o.log?.('packing file-area uploads');
    await fs.mkdir(deps.filesDir, { recursive: true });
    await encryptedFrom('tar', ['-C', deps.filesDir, '-cf', '-', '.'], join(o.dir, files.files!), o.key);
    if (o.configFile) await pipeline(createReadStream(o.configFile), encryptor(o.key), createWriteStream(join(o.dir, files.config!)));
    const manifest = {
      format: 'backup-v1', made_at: new Date(deps.now()).toISOString(), run: id,
      files: Object.fromEntries(await Promise.all(Object.entries(files).filter(([k]) => k !== 'config' || o.configFile).map(async ([k, name]) => [k, { name, sha256: await hashFile(join(o.dir, name)), size: (await fs.stat(join(o.dir, name))).size }]))),
      counts: await counts(deps.db), homepage_files: await countHomeFiles(deps.homes.root), area_files: await countHomeFiles(deps.filesDir),
      ...(o.mudDatabaseUrl ? { mud_counts: await mudCounts(o.mudDatabaseUrl) } : {}),
    };
    const name = `${stamp}-manifest.json`;
    await fs.writeFile(join(o.dir, name), `${JSON.stringify(manifest, null, 2)}\n`);
    const size = Object.values(manifest.files).reduce((n: number, f) => n + (f as { size: number }).size, 0);
    await deps.db.query(`UPDATE backup_runs SET status = 'ok', finished_at = now(), size_bytes = $2, location = $3, detail = $4 WHERE id = $1`, [id, size, name, JSON.stringify({ counts: manifest.counts, homepage_files: manifest.homepage_files })]);
    return { manifest: name };
  } catch (err) {
    await deps.db.query(`UPDATE backup_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`, [id, String(err instanceof Error ? err.message : err).slice(0, 500)]);
    throw err;
  }
}

interface Check { name: string; expected: unknown; actual: unknown; ok: boolean }

// Brings the newest backup back into a scratch database and compares it with what the manifest says.
export async function restoreTest(deps: AppDeps, o: BackupOptions): Promise<{ ok: boolean; checks: Check[] }> {
  const id = newId('bk');
  await deps.db.query(`INSERT INTO backup_runs (id, kind) VALUES ($1, 'restore_test')`, [id]);
  const checks: Check[] = [];
  const add = (name: string, expected: unknown, actual: unknown) => checks.push({ name, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual) });
  const work = await fs.mkdtemp(join(tmpdir(), 'restore-test-'));
  const scratch = `restore_test_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: (() => { const u = new URL(o.databaseUrl); u.pathname = '/postgres'; return u.toString(); })() });
  let location: string | null = null;
  let connected = false; // a client that never connected must not be asked to do anything: it would wait forever
  try {
    const names = (await fs.readdir(o.dir)).filter((f) => f.endsWith('-manifest.json')).sort();
    const newest = names.at(-1);
    if (!newest) throw new Error(`No backup found in ${o.dir}.`);
    location = newest;
    const manifest = JSON.parse(await fs.readFile(join(o.dir, newest), 'utf8')) as { files: Record<string, { name: string; sha256: string; size: number }>; counts: Record<string, number>; homepage_files: number; area_files?: number; mud_counts?: Record<string, number> };
    for (const [kind, f] of Object.entries(manifest.files)) add(`${kind} file is intact`, f.sha256, await hashFile(join(o.dir, f.name)));

    if (checks.every((c) => c.ok)) {
      const dump = join(work, 'db.dump');
      await decryptTo(join(o.dir, manifest.files.db!.name), o.key, dump);
      await admin.connect();
      connected = true;
      await admin.query(`CREATE DATABASE ${scratch}`);
      const url = new URL(o.databaseUrl); url.pathname = `/${scratch}`;
      await new Promise<void>((resolve, reject) => {
        const p = spawn('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', url.toString(), dump], { stdio: ['ignore', 'ignore', 'pipe'] });
        let err = ''; p.stderr.on('data', (d) => { err += d; });
        p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`pg_restore failed: ${err.trim().slice(0, 300)}`))));
      });
      const restored = new pg.Client({ connectionString: url.toString() });
      await restored.connect();
      try {
        const got = await counts({ query: (sql) => restored.query(sql) as never });
        for (const [k, v] of Object.entries(manifest.counts)) add(`${k} restored`, v, got[k]);
      } finally { await restored.end(); }

      const filesIn = async (kind: string, what: string): Promise<number> => {
        const tarFile = join(work, `${kind}.tar`);
        await decryptTo(join(o.dir, manifest.files[kind]!.name), o.key, tarFile);
        const listing = await new Promise<string>((resolve, reject) => {
          const p = spawn('tar', ['-tf', tarFile], { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = ''; p.stdout.on('data', (d) => { out += d; });
          p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`the ${what} archive cannot be read`))));
        });
        return listing.split('\n').filter((l) => l && !l.endsWith('/')).length;
      };
      add('homepage files restored', manifest.homepage_files, await filesIn('homes', 'homepage'));
      if (manifest.files.files && manifest.area_files !== undefined) add('file-area uploads restored', manifest.area_files, await filesIn('files', 'file-area'));

      if (manifest.files.mud && manifest.mud_counts) {
        const mudDump = join(work, 'mud.dump');
        await decryptTo(join(o.dir, manifest.files.mud.name), o.key, mudDump);
        await admin.query(`CREATE DATABASE ${scratch}_mud`);
        const mudUrl = new URL(o.databaseUrl); mudUrl.pathname = `/${scratch}_mud`;
        await new Promise<void>((resolve, reject) => {
          const p = spawn('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', mudUrl.toString(), mudDump], { stdio: ['ignore', 'ignore', 'pipe'] });
          let err = ''; p.stderr.on('data', (d) => { err += d; });
          p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`pg_restore of the MUD failed: ${err.trim().slice(0, 300)}`))));
        });
        const got = await mudCounts(mudUrl.toString());
        for (const [k, v] of Object.entries(manifest.mud_counts)) add(`MUD ${k} restored`, v, got[k]);
      }
    }
    const ok = checks.every((c) => c.ok);
    await deps.db.query(`UPDATE backup_runs SET status = $2, finished_at = now(), location = $3, detail = $4, error = $5 WHERE id = $1`,
      [id, ok ? 'ok' : 'failed', location, JSON.stringify({ checks }), ok ? null : `${checks.filter((c) => !c.ok).length} check(s) failed`]);
    return { ok, checks };
  } catch (err) {
    await deps.db.query(`UPDATE backup_runs SET status = 'failed', finished_at = now(), location = $2, detail = $3, error = $4 WHERE id = $1`,
      [id, location, JSON.stringify({ checks }), String(err instanceof Error ? err.message : err).slice(0, 500)]);
    return { ok: false, checks };
  } finally {
    if (connected) {
      await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${scratch}_mud WITH (FORCE)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
    await fs.rm(work, { recursive: true, force: true });
  }
}
