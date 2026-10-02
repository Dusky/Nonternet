import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser, ORIGIN, TEST_PASSWORD } from './test/harness';
import { processNext } from './exports/service';
import { pruneImports, readArchive } from './imports';

// An OpenSSH ed25519 public key line, built the way ssh-keygen writes it.
function ed25519Line(comment: string): string {
  const raw = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const str = (b: Buffer) => { const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); };
  return `ssh-ed25519 ${Buffer.concat([str(Buffer.from('ssh-ed25519')), str(raw)]).toString('base64')} ${comment}`;
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

// Rebuilds an archive with changed files and a new manifest, signed with a fresh key, as another site (or a
// forger) would. `site` changes the domain the manifest claims.
function rebuild(zip: Buffer, change: (files: Record<string, Uint8Array>) => void, opts: { site?: string; userId?: string; resign?: boolean } = {}): Buffer {
  const files = unzipSync(new Uint8Array(zip));
  const manifest = JSON.parse(Buffer.from(files['manifest.json']!).toString('utf8'));
  delete files['manifest.json'];
  delete files['manifest.sig'];
  change(files);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  if (opts.resign !== false) files['keys/public.key'] = strToU8(publicKey.export({ type: 'spki', format: 'pem' }) as string);
  manifest.files = Object.entries(files).map(([path, data]) => ({ path, size: data.length, sha256: sha(data) })).sort((a, b) => a.path.localeCompare(b.path));
  if (opts.site) manifest.site.domain = opts.site;
  if (opts.userId) manifest.user.id = opts.userId;
  const m = Buffer.from(JSON.stringify(manifest));
  files['manifest.json'] = m;
  files['manifest.sig'] = strToU8(sign(null, m, privateKey).toString('base64'));
  return Buffer.from(zipSync(files));
}

describe.skipIf(!dbAvailable)('bringing back an export', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type P = { id: string; handle: string; c: ReturnType<typeof client> };
  let alice: P, bob: P;
  let archive: Buffer;
  const person = async (handle: string): Promise<P> => { const u = await makeUser(ctx, { handle }); return { id: u.id, handle, c: await loginAs(ctx, handle) }; };
  const raw = async (p: P, method: 'PUT' | 'POST', url: string, body: Buffer | string) => {
    const r = await ctx.app.inject({ method, url, payload: body, headers: { origin: ORIGIN, cookie: `sid=${p.c.sid}`, 'content-type': 'application/octet-stream' } });
    let parsed: any = null;
    try { parsed = r.json(); } catch { /* no body */ }
    return { status: r.statusCode, body: parsed };
  };
  const preview = (p: P, zip: Buffer) => raw(p, 'POST', '/api/v1/me/import', zip);
  const apply = (p: P, id: string, body: Record<string, unknown> = {}) =>
    p.c.post(`/api/v1/me/import/${id}/apply`, { password: TEST_PASSWORD, parts: ['profile', 'settings', 'avatar', 'homepage', 'files', 'keys'], ...body });
  const homeFile = (p: P, path: string) => join(ctx.deps.homes.dir(p.id), path);

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    alice = await person('alice');
    bob = await person('bob');
    // Alice makes her things: profile, settings, a picture, a homepage, a file and an SSH key; and a post and a mail, which stay behind.
    await alice.c.patch('/api/v1/me', { display_name: 'Alice A.', bio: 'Makes synth patches.', theme: 'terminal', theme_variant: 'green', status_line: 'Patching', away: true });
    await db.query(`INSERT INTO notification_prefs (user_id, kind, enabled) VALUES ($1, 'mention', false) ON CONFLICT (user_id, kind) DO UPDATE SET enabled = false`, [alice.id]);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3366ff' } }).png().toBuffer();
    expect((await raw(alice, 'PUT', '/api/v1/me/avatar', png)).status).toBeLessThan(300);
    await raw(alice, 'PUT', '/api/v1/homes/me/file?path=index.html', '<h1>alice</h1>');
    await raw(alice, 'PUT', '/api/v1/homes/me/file?path=img/dot.txt', 'a dot');
    await alice.c.patch('/api/v1/homes/me', { title: 'Alice’s place', guestbook_mode: 'approval' });
    await db.query(`INSERT INTO file_areas (id, slug, name, upload_role) VALUES ('fa_01HZZZZZZZZZZZZZZZZZZZZZZZ', 'tools', 'Tools', 'user')`);
    expect((await raw(alice, 'POST', '/api/v1/files/areas/tools/files?name=readme.txt&title=Read%20me', 'my own file')).status).toBeLessThan(300);
    expect((await alice.c.post('/api/v1/me/ssh-keys', { name: 'laptop', public_key: ed25519Line('me@laptop') })).status).toBeLessThan(300);
    await alice.c.post('/api/v1/boards', { slug: 'general', name: 'General', visibility: 'public' }).catch(() => undefined);
    await alice.c.post('/api/v1/mail', { to: ['bob'], subject: 'Lunch', body: 'Noon?' });
    // Her export.
    expect((await alice.c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [alice.id])).rows[0]!;
    archive = readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`));
  });
  afterAll(async () => drop());

  it('previews what comes back and what stays in the archive, changing nothing', async () => {
    const r = await preview(alice, archive);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ origin: 'this_site', handle: 'alice' });
    const parts = Object.fromEntries(r.body.parts.map((p: { part: string; count: number }) => [p.part, p.count]));
    expect(parts).toEqual({ profile: 1, settings: 1, avatar: 1, homepage: 2, files: 1, keys: 1 });
    expect(r.body.parts.find((p: { part: string }) => p.part === 'homepage').issues).toEqual([{ code: 'exists', count: 2 }]);
    expect(r.body.skipped.map((s: { kind: string }) => s.kind)).toContain('mail');
  });

  it('brings back her own things after they were lost, and never touches handle, email or role', async () => {
    // She loses them.
    await alice.c.patch('/api/v1/me', { display_name: 'Changed', bio: null, theme: 'webring', theme_variant: null, status_line: null, away: false });
    await db.query(`DELETE FROM notification_prefs WHERE user_id = $1`, [alice.id]);
    await alice.c.delete('/api/v1/me/avatar');
    await alice.c.delete('/api/v1/homes/me/file?path=index.html');
    const f = (await db.query<{ id: string }>(`SELECT id FROM files WHERE uploader_id = $1`, [alice.id])).rows[0]!;
    await db.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [f.id]);
    await db.query(`DELETE FROM ssh_keys WHERE user_id = $1`, [alice.id]);

    const p = await preview(alice, archive);
    expect((await apply(alice, p.body.id, { password: 'wrong' })).body.error.code).toBe('wrong_password');
    const r = await apply(alice, p.body.id);
    expect(r.status).toBe(200);
    const got = Object.fromEntries(r.body.parts.map((x: { part: string; restored: number }) => [x.part, x.restored]));
    expect(got).toEqual({ profile: 1, settings: 1, avatar: 1, homepage: 1, files: 1, keys: 1 });
    expect(r.body.parts.find((x: { part: string }) => x.part === 'homepage').issues).toEqual([{ code: 'exists', count: 1 }]); // img/dot.txt was still there

    const u = (await db.query(`SELECT handle, email, role, display_name, bio, theme, theme_variant, status_line, away, avatar_at FROM users WHERE id = $1`, [alice.id])).rows[0];
    expect(u).toMatchObject({ handle: 'alice', role: 'user', display_name: 'Alice A.', bio: 'Makes synth patches.', theme: 'terminal', theme_variant: 'green', status_line: 'Patching', away: true });
    expect(u.avatar_at).not.toBeNull();
    expect((await db.query(`SELECT enabled FROM notification_prefs WHERE user_id = $1 AND kind = 'mention'`, [alice.id])).rows[0]).toEqual({ enabled: false });
    expect(readFileSync(homeFile(alice, 'index.html'), 'utf8')).toBe('<h1>alice</h1>');
    expect((await db.query(`SELECT title FROM homepages WHERE user_id = $1`, [alice.id])).rows[0]).toEqual({ title: 'Alice’s place' });
    expect((await db.query(`SELECT name, title FROM files WHERE uploader_id = $1 AND deleted_at IS NULL`, [alice.id])).rows).toEqual([{ name: 'readme.txt', title: 'Read me' }]);
    expect((await db.query(`SELECT name FROM ssh_keys WHERE user_id = $1`, [alice.id])).rows).toEqual([{ name: 'laptop' }]);
    expect((await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'import.applied' AND actor_id = $1`, [alice.id])).rows[0].n).toBe(1);
  });

  it('brings an archive back only once', async () => {
    const p = await preview(alice, archive);
    expect((await apply(alice, p.body.id)).body.error.code).toBe('already_applied');
  });

  it('refuses an archive that claims to be from here for you but was signed with another key', async () => {
    expect((await preview(alice, rebuild(archive, () => undefined))).body.error.code).toBe('bad_archive');
  });

  it('refuses an archive that was changed, has extra files, or belongs to someone else here', async () => {
    const files = unzipSync(new Uint8Array(archive));
    files['homepage/index.html'] = strToU8('<h1>evil</h1>');
    expect((await preview(alice, Buffer.from(zipSync(files)))).body.error.code).toBe('bad_archive');
    const extra = unzipSync(new Uint8Array(archive));
    extra['homepage/extra.html'] = strToU8('sneaked in');
    expect((await preview(alice, Buffer.from(zipSync(extra)))).body.error.code).toBe('bad_archive');
    expect((await preview(bob, archive)).body.error.code).toBe('not_yours');
    expect((await preview(alice, Buffer.from('not a zip'))).body.error.code).toBe('bad_archive');
    expect(() => readArchive(new Uint8Array(archive), 10)).toThrow(/unpacks to more/);
  });

  it('takes an archive from another site, says its origin is not proven, and keeps paths inside the homepage', async () => {
    const elsewhere = rebuild(archive, (f) => {
      f['homepage/../escape.html'] = strToU8('outside');
      f['homepage/from-afar.html'] = strToU8('hello from afar');
    }, { site: 'elsewhere.test', userId: 'u_01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    await raw(bob, 'PUT', '/api/v1/homes/me/file?path=from-afar.html', 'mine');
    const p = await preview(bob, elsewhere);
    expect(p.status).toBe(200);
    expect(p.body.origin).toBe('other_site');
    const r = await apply(bob, p.body.id, { parts: ['homepage', 'files'] });
    const hp = r.body.parts.find((x: { part: string }) => x.part === 'homepage');
    expect(hp.issues).toContainEqual({ code: 'bad_path', count: 1 });
    expect(hp.issues).toContainEqual({ code: 'exists', count: 1 });
    expect(readFileSync(homeFile(bob, 'from-afar.html'), 'utf8')).toBe('mine'); // kept unless asked to replace
    expect(existsSync(join(ctx.deps.homes.dir(bob.id), '..', 'escape.html'))).toBe(false);
    expect(r.body.parts.find((x: { part: string }) => x.part === 'files').issues).toEqual([{ code: 'name_taken', count: 1 }]); // alice's readme.txt is in tools already
    // Asked to replace (a fresh copy of the archive, since one archive comes back once):
    const again = rebuild(elsewhere, () => undefined, { site: 'elsewhere.test' });
    const p2 = await preview(bob, again);
    await apply(bob, p2.body.id, { parts: ['homepage'], replace_homepage: true });
    expect(readFileSync(homeFile(bob, 'from-afar.html'), 'utf8')).toBe('hello from afar');
  });

  it('forgets uploads nobody applied after an hour', async () => {
    const p = await preview(alice, rebuild(archive, () => undefined, { site: 'elsewhere.test' }));
    const now = ctx.deps.now;
    ctx.deps.now = () => Date.now() + 2 * 3_600_000;
    try {
      expect(await pruneImports(ctx.deps)).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(ctx.deps.exportsDir, 'imports', `${p.body.id}.zip`))).toBe(false);
    } finally { ctx.deps.now = now; }
  });
});
