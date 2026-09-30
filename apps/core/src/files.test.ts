import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('file areas', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  type C = Awaited<ReturnType<typeof loginAs>>;
  const person = async (role: 'guest' | 'user' | 'trusted' = 'user') => { const u = await makeUser(ctx, { role, verified: role !== 'guest' }); return { ...u, c: await loginAs(ctx, u.handle) }; };
  const upload = (c: C | null, area: string, name: string, body: Buffer | string, extra = '') => ctx.app.inject({
    method: 'POST', url: `/api/v1/files/areas/${area}/files?name=${encodeURIComponent(name)}${extra}`, payload: body,
    headers: { origin: 'https://example.test', 'content-type': 'text/html', ...(c ? { cookie: `sid=${c.sid}` } : {}) },
  });
  const download = (c: C | null, id: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/files/${id}/download`, headers: c ? { cookie: `sid=${c.sid}` } : {} });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
    await admin.client.post('/api/v1/admin/files/areas', { slug: 'games', name: 'Games', description: 'Shareware and demos' });
    await admin.client.post('/api/v1/admin/files/areas', { slug: 'club', name: 'Club', visibility: 'members', upload_role: 'user' });
  });
  afterAll(async () => drop());

  it('lets admins make areas, and nobody else', async () => {
    const t = await person('trusted');
    expect((await t.c.post('/api/v1/admin/files/areas', { slug: 'mine', name: 'Mine' })).status).toBe(403);
    expect((await admin.client.post('/api/v1/admin/files/areas', { slug: 'games', name: 'Again' })).body.error.code).toBe('slug_taken');
    const pub = (await client(ctx.app).get('/api/v1/files')).body.areas.map((a: { slug: string }) => a.slug);
    expect(pub).toEqual(['games']); // members-only areas are hidden from visitors
    const mine = (await t.c.get('/api/v1/files')).body.areas;
    expect(mine.map((a: { slug: string; can_upload: boolean }) => `${a.slug}:${a.can_upload}`)).toEqual(['club:true', 'games:true']);
    const audit = await db.query(`SELECT action FROM audit_log WHERE action LIKE 'file_area.%'`);
    expect(audit.rowCount).toBe(2);
  });

  it('takes uploads from trusted people, serves them only as downloads, and counts them', async () => {
    const t = await person('trusted'); const u = await person();
    const html = '<script>alert(document.cookie)</script>';
    const r = await upload(t.c, 'games', 'évil page.html', html, '&title=A%20page&description=Not%20really');
    expect(r.statusCode).toBe(201);
    const f = r.json();
    expect(f).toMatchObject({ name: 'évil_page.html', title: 'A page', size_bytes: html.length, uploader: { handle: t.handle }, mine: true, downloads: 0 });
    expect(existsSync(join(ctx.deps.filesDir, f.id))).toBe(true);
    expect((await upload(u.c, 'games', 'x.txt', 'hi')).json().error.code).toBe('forbidden');
    expect((await upload(null, 'games', 'x.txt', 'hi')).statusCode).toBe(401);
    expect((await upload(t.c, 'games', 'évil page.html', 'again')).json().error.code).toBe('name_taken');
    for (const bad of ['../etc/passwd', '.hidden', 'a/b.txt', '']) expect((await upload(t.c, 'games', bad, 'x')).json().error.code).toBe('bad_name');
    expect((await upload(t.c, 'games', 'empty.txt', '')).json().error.code).toBe('empty');

    const d = await download(null, f.id);
    expect(d.statusCode).toBe(200);
    expect(d.body).toBe(html);
    expect(d.headers['content-type']).toBe('application/octet-stream');
    expect(d.headers['content-disposition']).toBe(`attachment; filename="_vil_page.html"; filename*=UTF-8''%C3%A9vil_page.html`);
    expect(d.headers['x-content-type-options']).toBe('nosniff');
    expect(d.headers['content-security-policy']).toContain('sandbox');
    expect((await client(ctx.app).get(`/api/v1/files/${f.id}`)).body.downloads).toBe(1);
    const list = (await client(ctx.app).get('/api/v1/files/areas/games')).body;
    expect(list.area).toMatchObject({ slug: 'games', file_count: 1, can_upload: false });
    expect(list.files[0]).toMatchObject({ id: f.id, mine: false, download_url: `/api/v1/files/${f.id}/download` });
  });

  it('keeps members-only areas from visitors, and lets users upload where the area allows', async () => {
    const u = await person(); const g = await person('guest');
    const f = (await upload(u.c, 'club', 'notes.txt', 'members only')).json();
    expect(f.id).toMatch(/^f_/);
    expect((await client(ctx.app).get('/api/v1/files/areas/club')).status).toBe(404);
    expect((await download(null, f.id)).statusCode).toBe(404);
    expect((await download(g.c, f.id)).statusCode).toBe(404); // a guest hasn't confirmed their email
    expect((await upload(g.c, 'club', 'g.txt', 'x')).json().error.code).toBe('not_found');
  });

  it('holds each uploader to the file size limit and their quota', async () => {
    const t = await person('trusted');
    ctx.deps.config.limits.file_max_mb = 1;
    ctx.deps.config.limits.file_quota_mb = 1.5;
    try {
      const mb = Buffer.alloc(1024 * 1024, 1);
      expect((await upload(t.c, 'games', 'big.bin', Buffer.concat([mb, Buffer.from('x')]))).statusCode).toBe(413);
      expect((await upload(t.c, 'games', 'one.bin', mb)).statusCode).toBe(201);
      expect((await upload(t.c, 'games', 'two.bin', mb)).json().error.code).toBe('over_quota');
      expect((await t.c.get('/api/v1/me/files')).body).toEqual({ used_bytes: 1024 * 1024, quota_bytes: 1.5 * 1024 * 1024, max_file_bytes: 1024 * 1024 });
      expect((await upload(admin.client, 'games', 'admin-one.bin', mb)).statusCode).toBe(201);
      expect((await upload(admin.client, 'games', 'admin-two.bin', mb)).statusCode).toBe(201); // admins have no quota
      expect(readFileSync(join(ctx.deps.filesDir, (await db.query(`SELECT id FROM files WHERE name = 'one.bin'`)).rows[0]!.id)).length).toBe(1024 * 1024);
    } finally {
      ctx.deps.config.limits.file_max_mb = 25;
      ctx.deps.config.limits.file_quota_mb = 250;
    }
  });

  it('lets the uploader edit and delete, and admins hide, delete with a reason, and act on reports', async () => {
    const t = await person('trusted'); const u = await person();
    const f = (await upload(t.c, 'games', 'demo.zip', 'PK...')).json();
    expect((await u.c.patch(`/api/v1/files/${f.id}`, { title: 'mine now' })).status).toBe(403);
    expect((await t.c.patch(`/api/v1/files/${f.id}`, { title: 'The demo' })).body.title).toBe('The demo');
    expect((await t.c.post(`/api/v1/files/${f.id}/report`, { category: 'spam' })).body.error.code).toBe('self');
    expect((await u.c.post(`/api/v1/files/${f.id}/report`, { category: 'illegal', note: 'pirated' })).status).toBe(201);
    const rep = (await admin.client.get('/api/v1/reports')).body.reports.find((x: { target: { id: string } }) => x.target.id === f.id);
    expect(rep).toMatchObject({ target: { type: 'file', handle: t.handle }, excerpt: 'demo.zip — The demo', status: 'open' });

    expect((await u.c.post(`/api/v1/admin/files/${f.id}/hide`, { reason: 'nope' })).status).toBe(403);
    expect((await admin.client.post(`/api/v1/admin/files/${f.id}/hide`, { reason: 'looks pirated' })).status).toBe(204);
    expect((await download(u.c, f.id)).statusCode).toBe(404);
    expect((await download(t.c, f.id)).statusCode).toBe(200); // the uploader still sees it
    expect((await client(ctx.app).get('/api/v1/files/areas/games')).body.files.map((x: { id: string }) => x.id)).not.toContain(f.id);
    expect((await admin.client.get('/api/v1/reports?status=all')).body.reports.find((x: { target: { id: string } }) => x.target.id === f.id).status).toBe('actioned');
    await admin.client.post(`/api/v1/admin/files/${f.id}/unhide`, { reason: 'checked, it is freeware' });

    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/v1/files/${f.id}`, headers: { origin: 'https://example.test', cookie: `sid=${u.c.sid}` } })).statusCode).toBe(403);
    expect((await admin.client.delete(`/api/v1/files/${f.id}`)).body.error.code).toBe('reason_required');
    const g = (await upload(t.c, 'games', 'gone.txt', 'bye')).json();
    expect((await t.c.delete(`/api/v1/files/${g.id}`)).status).toBe(204);
    expect(existsSync(join(ctx.deps.filesDir, g.id))).toBe(false);
    expect((await download(null, g.id)).statusCode).toBe(404);
    const actions = (await db.query(`SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id`, [f.id])).rows.map((x) => x.action);
    expect(actions).toEqual(['report.created', 'file.hidden', 'file.unhidden']);
  });

  it('archives an area so nothing new goes in, and deleting an account removes its uploads', async () => {
    const t = await person('trusted');
    await admin.client.post('/api/v1/admin/files/areas', { slug: 'old', name: 'Old stuff' });
    const f = (await upload(t.c, 'old', 'keep.txt', 'x')).json();
    expect((await admin.client.patch('/api/v1/admin/files/areas/old', { archived: true })).body.archived).toBe(true);
    expect((await upload(t.c, 'old', 'more.txt', 'x')).json().error.code).toBe('archived');
    expect((await client(ctx.app).get('/api/v1/files')).body.areas.map((a: { slug: string }) => a.slug)).not.toContain('old');
    expect((await admin.client.post(`/api/v1/admin/users/${t.id}/delete`, { posts: 'keep', reason: 'asked' })).status).toBe(204);
    expect(existsSync(join(ctx.deps.filesDir, f.id))).toBe(false);
    expect((await db.query(`SELECT uploader_id, deleted_at IS NOT NULL AS gone FROM files WHERE id = $1`, [f.id])).rows[0]).toEqual({ uploader_id: null, gone: true });
  });
});
