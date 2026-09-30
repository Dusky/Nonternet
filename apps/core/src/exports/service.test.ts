import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDecipheriv, createPublicKey, scryptSync, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { client, createTestDb, dbAvailable, first, loginAs, makeApp, makeUser, TEST_PASSWORD } from '../test/harness';
import { processNext, pruneExports } from './service';

describe.skipIf(!dbAvailable)('export', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type P = { id: string; handle: string; c: ReturnType<typeof client> };
  let alice: P, bob: P;
  const person = async (handle: string, role: 'user' | 'trusted' = 'user'): Promise<P> => { const u = await makeUser(ctx, { role, handle }); return { id: u.id, handle, c: await loginAs(ctx, handle) }; };
  const ask = (p: P, body: Record<string, unknown> = { password: TEST_PASSWORD }) => p.c.post('/api/v1/me/export', body);
  const put = (p: P, path: string, body: Buffer | string) => ctx.app.inject({ method: 'PUT', url: `/api/v1/homes/me/file?path=${path}`, payload: body, headers: { origin: 'https://example.test', cookie: `sid=${p.c.sid}`, 'content-type': 'application/octet-stream' } });
  const download = (p: P, id: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/me/exports/${id}/download`, headers: { cookie: `sid=${p.c.sid}` } });
  const unzip = (buf: Buffer) => unzipSync(new Uint8Array(buf));
  const text = (files: Record<string, Uint8Array>, name: string) => strFromU8(files[name]!);

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ctx.deps.config.limits.trusted_board_quota = 10;
    alice = await person('alice', 'trusted');
    bob = await person('bob');
    // Alice makes things in every part of the site.
    await alice.c.post('/api/v1/boards', { slug: 'general', name: 'General', visibility: 'public' });
    await alice.c.post('/api/v1/boards', { slug: 'club', name: 'Club', visibility: 'private' });
    await alice.c.post('/api/v1/boards', { slug: 'mine', name: 'Mine', description: 'A board I own', visibility: 'public' });
    const t = (await alice.c.post('/api/v1/boards/general/posts', { subject: 'Café hours', body: 'Open at nine.\nFrom me to you, always.' })).body;
    await bob.c.post('/api/v1/boards/general/posts', { body: 'Bob replying, not in alice’s export', reply_to: t.id });
    await alice.c.post('/api/v1/boards/general/posts', { body: 'And one more reply', reply_to: t.id });
    await alice.c.post('/api/v1/boards/club/posts', { subject: 'Private thoughts', body: 'Members only, but written by me.' });
    const gone = (await alice.c.post('/api/v1/boards/general/posts', { subject: 'Oops', body: 'deleted words' })).body;
    await alice.c.delete(`/api/v1/posts/${gone.id}`);
    await put(alice, 'index.html', '<h1>alice</h1>');
    await put(alice, 'img/pixel.gif', Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 1, 2, 255]));
    await alice.c.patch('/api/v1/homes/me', { title: 'Alice’s place', guestbook_mode: 'approval' });
    await ctx.app.inject({ method: 'POST', url: '/api/v1/widgets/alice/guestbook', payload: { name: 'Visitor', message: 'Nice page' }, headers: { origin: 'https://x.test' } });
    await bob.c.post('/api/v1/homes/alice/guestbook', { message: 'From bob, signed in' });
    await put(bob, 'index.html', '<h1>bob</h1>');
    await alice.c.post('/api/v1/homes/bob/guestbook', { message: 'Alice signing bob’s guestbook' });
    await alice.c.post('/api/v1/rings', { slug: 'synths', name: 'Synths', description: 'Beeps', tags: ['music'] });
    await bob.c.post('/api/v1/rings/synths/join');
    await alice.c.post('/api/v1/homes/me/domains', { domain: 'alice-site.com' });
    await db.query(`INSERT INTO handle_history (user_id, handle) VALUES ($1, 'oldalice')`, [alice.id]);
    const mt = (await alice.c.post('/api/v1/mail', { to: ['bob'], subject: 'Lunch', body: 'Noon at the café?' })).body;
    await bob.c.post(`/api/v1/mail/${mt.id}/messages`, { body: 'Bob’s private reply' });
    const dave = await person('dave');
    await alice.c.post('/api/v1/me/blocks', { handle: dave.handle });
    await db.query(`INSERT INTO file_areas (id, slug, name) VALUES ('fa_01HZZZZZZZZZZZZZZZZZZZZZZZ', 'tools', 'Tools')`);
    await ctx.app.inject({ method: 'POST', url: '/api/v1/files/areas/tools/files?name=readme.txt&title=Read%20me', payload: 'my own file', headers: { origin: 'https://example.test', cookie: `sid=${alice.c.sid}`, 'content-type': 'application/octet-stream' } });
  });
  afterAll(async () => drop());

  it('needs the password again, and never for someone else', async () => {
    expect((await ask(alice, { password: 'wrong' })).body.error.code).toBe('wrong_password');
    expect((await ask({ ...alice, c: client(ctx.app) })).status).toBe(401);
    expect(first(await db.query(`SELECT count(*)::int AS n FROM exports`)).n).toBe(0);
  });

  it('queues an export, builds it, and tells the person by email', async () => {
    const r = await ask(alice);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'queued', includes_private_key: false });
    expect((await download(alice, r.body.id)).statusCode).toBe(409); // not ready yet
    expect(await processNext(ctx.deps)).toBe(true);
    expect(await processNext(ctx.deps)).toBe(false);
    const list = (await alice.c.get('/api/v1/me/exports')).body.exports;
    expect(list[0]).toMatchObject({ id: r.body.id, status: 'ready', error: null });
    expect(list[0].size_bytes).toBeGreaterThan(0);
    expect(new Date(list[0].expires_at).getTime() - new Date(list[0].ready_at).getTime()).toBeGreaterThan(6.9 * 86400_000);
    const mail = ctx.mailer.sent.find((m) => m.subject.includes('export is ready'))!;
    expect(mail.to).toBe('alice@example.test');
    expect(mail.text).toContain('https://example.test/settings/data');
  });

  it('allows one export a day', async () => {
    const again = await ask(alice);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('export_rate_limited');
    ctx.clock.advance(25 * 3600);
    expect((await ask(alice)).status).toBe(202);
    await processNext(ctx.deps);
  });

  describe('the archive', () => {
    let files: Record<string, Uint8Array>;
    beforeAll(async () => {
      const id = first(await db.query(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready' ORDER BY requested_at LIMIT 1`, [alice.id])).id;
      const res = await download(alice, id);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="alice-\d{4}-\d{2}-\d{2}\.zip"$/);
      expect(res.headers['cache-control']).toBe('no-store');
      files = unzip(res.rawPayload);
    });

    it('holds what she made, and nothing that is not hers', () => {
      expect(Object.keys(files).sort()).toEqual([
        'README.txt', 'boards/club.json', 'boards/general.json', 'boards/mine.json', 'files.json', 'files/tools/readme.txt', 'guestbook.json', 'homepage.json', 'homepage/img/pixel.gif', 'homepage/index.html',
        'keys/public.key', 'mail/blocked.json', 'mail/conversations.json', 'manifest.json', 'manifest.sig', 'posts/posts.json', 'posts/posts.mbox', 'profile.json', 'rings/synths/members.json', 'rings/synths/ring.json',
      ].sort());
      const posts = JSON.parse(text(files, 'posts/posts.json')) as { subject: string; body: string; board: string; state: string; reply_to: string | null }[];
      expect(posts.map((p) => p.subject)).toEqual(['Café hours', 'Re: Café hours', 'Private thoughts', '']);
      expect(posts.find((p) => p.board === 'club')).toMatchObject({ body: 'Members only, but written by me.' }); // her own words on a private board
      expect(posts.at(-1)).toMatchObject({ state: 'deleted', body: '' }); // the tombstone, with nothing inside
      expect(JSON.stringify(posts)).not.toContain('Bob replying');
      expect(JSON.stringify(posts)).not.toContain('deleted words');
      expect(text(files, 'posts/posts.mbox')).toContain('Subject: =?UTF-8?B?'); // café
      expect(text(files, 'posts/posts.mbox')).toContain('>From me to you, always.');
      expect(text(files, 'posts/posts.mbox').match(/^From alice@example\.test /gm)).toHaveLength(3); // deleted post left out
    });

    it('has her mail conversations with only her own messages, and who she blocked', () => {
      const conv = JSON.parse(text(files, 'mail/conversations.json'));
      expect(conv).toEqual([expect.objectContaining({ subject: 'Lunch', people: ['alice', 'bob'], my_messages: [expect.objectContaining({ body: 'Noon at the café?' })] })]);
      expect(JSON.stringify(conv)).not.toContain('Bob’s private reply');
      expect(JSON.parse(text(files, 'mail/blocked.json'))).toEqual(['dave']);
    });

    it('has the files she uploaded, as uploaded', () => {
      expect(text(files, 'files/tools/readme.txt')).toBe('my own file');
      expect(JSON.parse(text(files, 'files.json'))).toEqual([expect.objectContaining({ area: 'tools', name: 'readme.txt', title: 'Read me', size_bytes: 11 })]);
    });

    it('has her homepage exactly as uploaded, its settings and both guestbook directions', () => {
      expect(text(files, 'homepage/index.html')).toBe('<h1>alice</h1>');
      expect([...files['homepage/img/pixel.gif']!]).toEqual([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 1, 2, 255]);
      expect(JSON.parse(text(files, 'homepage.json'))).toMatchObject({ title: 'Alice’s place', guestbook_mode: 'approval' });
      const gb = JSON.parse(text(files, 'guestbook.json'));
      expect(gb.on_my_page.map((e: { name: string; status: string }) => `${e.name}:${e.status}`).sort()).toEqual(['Visitor:pending', 'bob:pending']); // the guestbook is set to approval, for signed-in people too
      expect(gb.signed_by_me).toEqual([expect.objectContaining({ page_of: 'bob', message: 'Alice signing bob’s guestbook' })]);
    });

    it('has her profile, her ring with its public member list, and her board', () => {
      const profile = JSON.parse(text(files, 'profile.json'));
      expect(profile).toMatchObject({ handle: 'alice', email: 'alice@example.test', role: 'trusted', previous_handles: [expect.objectContaining({ handle: 'oldalice' })] });
      expect(profile.custom_domains).toEqual([expect.objectContaining({ domain: 'alice-site.com', status: 'pending' })]);
      expect(profile.private_board_memberships).toEqual(['club']);
      expect(profile.rings).toEqual([expect.objectContaining({ slug: 'synths', status: 'member' })]);
      expect(JSON.parse(text(files, 'rings/synths/ring.json'))).toMatchObject({ slug: 'synths', tags: ['music'], founder: 'alice' });
      expect(JSON.parse(text(files, 'rings/synths/members.json')).map((m: { handle: string }) => m.handle).sort()).toEqual(['alice', 'bob']);
      expect(JSON.parse(text(files, 'boards/mine.json'))).toMatchObject({ slug: 'mine', description: 'A board I own' });
      expect(text(files, 'README.txt')).toContain('Test Site');
      expect(text(files, 'README.txt')).toContain('Not included: other people');
    });

    it('lists every file with its hash, and the hashes are right', () => {
      const manifest = JSON.parse(text(files, 'manifest.json')) as { format: string; user: { handle: string }; files: { path: string; size: number; sha256: string }[] };
      expect(manifest).toMatchObject({ format: 'export-v1', user: { handle: 'alice' } });
      expect(manifest.files.map((f) => f.path).sort()).toEqual(Object.keys(files).filter((n) => !n.startsWith('manifest')).sort());
      for (const f of manifest.files) {
        expect(f.size, f.path).toBe(files[f.path]!.length);
        expect(f.sha256, f.path).toBe(require('node:crypto').createHash('sha256').update(files[f.path]!).digest('hex'));
      }
    });

    it('is signed with her key, and the signature does not survive a change', () => {
      const pub = createPublicKey(text(files, 'keys/public.key'));
      const manifest = Buffer.from(files['manifest.json']!);
      const sig = Buffer.from(text(files, 'manifest.sig'), 'base64');
      expect(verify(null, manifest, pub, sig)).toBe(true);
      expect(verify(null, Buffer.from(manifest.toString().replace('alice', 'mallory')), pub, sig)).toBe(false);
      // The key in the export is the one on her account, made at signup.
      expect(first(ctxKey()).public_key).toBe(text(files, 'keys/public.key'));
    });
    const ctxKey = () => ({ rows: [{ public_key: keyOf }] }) as unknown as { rows: { public_key: string }[] };
    let keyOf = '';
    beforeAll(async () => { keyOf = first(await db.query(`SELECT public_key FROM users WHERE handle = 'alice'`)).public_key; });
  });

  it('can include the private key, locked with her password and unlockable with it', async () => {
    ctx.clock.advance(25 * 3600);
    const r = await ask(alice, { password: TEST_PASSWORD, include_private_key: true });
    expect(r.body.includes_private_key).toBe(true);
    await processNext(ctx.deps);
    const files = unzip((await download(alice, r.body.id)).rawPayload);
    const blob = JSON.parse(strFromU8(files['keys/private.key.json']!));
    expect(blob).toMatchObject({ format: 'private-key-v1', kdf: 'scrypt', cipher: 'aes-256-gcm' });
    const key = scryptSync(TEST_PASSWORD, Buffer.from(blob.salt, 'base64'), 32, { N: blob.N, r: blob.r, p: blob.p, maxmem: 128 * 1024 * 1024 });
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
    d.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const pem = Buffer.concat([d.update(Buffer.from(blob.ciphertext, 'base64')), d.final()]).toString();
    expect(pem).toContain('BEGIN PRIVATE KEY');
    expect(first(await db.query(`SELECT private_key_blob FROM exports WHERE id = $1`, [r.body.id])).private_key_blob).toBeNull(); // not kept once used
    const wrong = scryptSync('wrong password', Buffer.from(blob.salt, 'base64'), 32, { N: blob.N, r: blob.r, p: blob.p, maxmem: 128 * 1024 * 1024 });
    const d2 = createDecipheriv('aes-256-gcm', wrong, Buffer.from(blob.iv, 'base64'));
    d2.setAuthTag(Buffer.from(blob.tag, 'base64'));
    expect(() => Buffer.concat([d2.update(Buffer.from(blob.ciphertext, 'base64')), d2.final()])).toThrow();
  });

  it('only lets the owner download, and only once it is ready', async () => {
    const id = first(await db.query(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready' LIMIT 1`, [alice.id])).id;
    expect((await download(bob, id)).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/me/exports/${id}/download` })).statusCode).toBe(401);
    expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'export.downloaded' AND actor_id = $1`, [alice.id])).n).toBeGreaterThan(0);
  });

  it('deletes archives after 7 days and says they have expired', async () => {
    const id = first(await db.query(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready' ORDER BY requested_at LIMIT 1`, [alice.id])).id;
    const file = join(ctx.deps.exportsDir, `${id}.zip`);
    expect(existsSync(file)).toBe(true);
    ctx.clock.advance(8 * 86400);
    expect((await download(alice, id)).statusCode).toBe(410);
    expect(await pruneExports(ctx.deps)).toBeGreaterThan(0);
    expect(existsSync(file)).toBe(false);
    expect(first(await db.query(`SELECT status FROM exports WHERE id = $1`, [id])).status).toBe('expired');
  });

  it('fails cleanly, keeps nothing half-built, and lets the person try again', async () => {
    const p = await person('carol');
    ctx.clock.advance(3 * 86400);
    const r = await ask(p);
    const real = ctx.deps.homes.tree.bind(ctx.deps.homes);
    ctx.deps.homes.tree = async () => { throw new Error('disk on fire'); };
    try { await processNext(ctx.deps); } finally { ctx.deps.homes.tree = real; }
    const row = first(await db.query(`SELECT status, error FROM exports WHERE id = $1`, [r.body.id]));
    expect(row.status).toBe('failed');
    expect(row.error).not.toContain('disk on fire'); // the person sees plain words, not internals
    expect(existsSync(join(ctx.deps.exportsDir, `${r.body.id}.zip.part`))).toBe(false);
    expect((await ask(p)).status).toBe(202); // a failed export does not use up the day
  });

  it('gives everyone a key at signup', async () => {
    expect(first(await db.query(`SELECT count(*)::int AS n FROM users WHERE public_key IS NULL AND handle = 'bob'`)).n).toBe(1); // made directly in the database, so lazily on the first export
    await ask(bob);
    while (await processNext(ctx.deps)) { /* the queue may hold others first */ }
    expect(first(await db.query(`SELECT public_key FROM users WHERE handle = 'bob'`)).public_key).toContain('BEGIN PUBLIC KEY');
  });
});
