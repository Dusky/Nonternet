import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

const request = {
  kind: 'copyright', url: 'https://example-homes.test/somebody/', description: 'This page copies my photographs without asking.',
  contact_name: 'A. Photographer', contact_email: 'photo@example.org', good_faith: true,
};

describe.skipIf(!dbAvailable)('legal pages and takedown requests', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
  });
  afterAll(async () => drop());

  it('shows placeholder text to anyone until an admin writes the page, using the configured site name', async () => {
    const r = await client(ctx.app).get('/api/v1/legal/terms');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ slug: 'terms', placeholder: true, version: 0 });
    expect(r.body.body).toContain('Test Site');
    expect((await client(ctx.app).get('/api/v1/legal/nonsense')).status).toBe(404);
    expect((await client(ctx.app).get('/api/v1/legal/takedown')).body.body).toContain('abuse@example.test');
  });

  it('lets an admin edit a page, keeps every version and audits it; nobody else can', async () => {
    const put = (c: typeof admin.client, body: object) => c.put('/api/v1/admin/legal/pages/privacy', body);
    const good = { title: 'Privacy', body: 'We keep what you give us and nothing more than that.', reason: 'first real text' };
    const u = await makeUser(ctx, { role: 'trusted' });
    expect((await put(await loginAs(ctx, u.handle), good)).status).toBe(403);
    expect((await put(admin.client, { ...good, body: 'too short' })).status).toBe(400);
    expect((await put(admin.client, good)).body).toMatchObject({ version: 1, placeholder: false });
    expect((await put(admin.client, { ...good, body: 'We keep less than before, which is good.', reason: 'trimmed' })).body.version).toBe(2);
    const seen = (await client(ctx.app).get('/api/v1/legal/privacy')).body;
    expect(seen).toMatchObject({ placeholder: false, version: 2, title: 'Privacy' });
    const versions = (await admin.client.get('/api/v1/admin/legal/pages/privacy/versions')).body.versions;
    expect(versions.map((v: { version: number; reason: string }) => [v.version, v.reason])).toEqual([[2, 'trimmed'], [1, 'first real text']]);
    const a = await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'legal.page_saved' AND target_id = 'privacy'`);
    expect(a.rows[0]!.n).toBe(2);
  });

  it('takes a takedown request from someone signed out, and insists on the statement', async () => {
    const c = client(ctx.app);
    expect((await c.post('/api/v1/legal/requests', { ...request, good_faith: false })).status).toBe(400);
    expect((await c.post('/api/v1/legal/requests', { ...request, url: 'not a url' })).status).toBe(400);
    expect((await c.post('/api/v1/legal/requests', { ...request, description: 'short' })).status).toBe(400);
    const ok = await c.post('/api/v1/legal/requests', request);
    expect(ok.status).toBe(201);
    expect(ok.body.id).toMatch(/^lr_/);
    expect(Number((await db.query(`SELECT count(*) FROM audit_log WHERE action = 'legal.request_received'`)).rows[0]!.count)).toBe(1);
  });

  it('is rate limited by address', async () => {
    const limited = await makeApp(db, { rateLimit: true });
    const c = client(limited.app);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await c.post('/api/v1/legal/requests', request)).status);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses).toContain(429);
  });

  it('lists requests for admins only and lets them resolve each once, with a note', async () => {
    const list = await admin.client.get('/api/v1/admin/legal/requests?status=open');
    expect(list.body.requests.length).toBeGreaterThan(0);
    const id = list.body.requests[0].id;
    expect(list.body.requests[0]).toMatchObject({ contact_email: 'photo@example.org', status: 'open' });
    expect((await client(ctx.app).get('/api/v1/admin/legal/requests')).status).toBe(401);
    const u = await makeUser(ctx, { role: 'trusted' });
    expect((await (await loginAs(ctx, u.handle)).post(`/api/v1/admin/legal/requests/${id}/resolve`, { status: 'actioned', note: 'done' })).status).toBe(403);
    expect((await admin.client.post(`/api/v1/admin/legal/requests/${id}/resolve`, { status: 'actioned' })).status).toBe(400);
    expect((await admin.client.post(`/api/v1/admin/legal/requests/${id}/resolve`, { status: 'actioned', note: 'Removed the page.' })).status).toBe(204);
    expect((await admin.client.post(`/api/v1/admin/legal/requests/${id}/resolve`, { status: 'declined', note: 'again' })).status).toBe(404);
    const done = (await admin.client.get('/api/v1/admin/legal/requests')).body.requests.find((r: { id: string }) => r.id === id);
    expect(done).toMatchObject({ status: 'actioned', resolution_note: 'Removed the page.', resolved_by: admin.handle });
  });
});
