import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, ORIGIN, TEST_PASSWORD } from './test/harness';
import { processNext } from './exports/service';

describe.skipIf(!dbAvailable)('ring banners', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  const pic = (w: number, h: number, fmt: 'png' | 'jpeg' | 'gif' = 'png') => sharp({ create: { width: w, height: h, channels: 3, background: '#cc3366' } })[fmt]().toBuffer();
  const put = (c: { sid?: string }, slug: string, kind: string, body: Buffer | string) =>
    ctx.app.inject({ method: 'PUT', url: `/api/v1/rings/${slug}/banner/${kind}`, payload: body, headers: { origin: ORIGIN, cookie: `sid=${c.sid}`, 'content-type': 'application/octet-stream' } });
  async function ring() {
    const u = await makeUser(ctx, { role: 'trusted' });
    const c = await loginAs(ctx, u.handle);
    const slug = `rb${Math.random().toString(36).slice(2, 8)}`;
    expect((await c.post('/api/v1/rings', { slug, name: 'Banner ring', description: 'x', tags: [] })).status).toBe(201);
    return { u, c, slug };
  }

  it('draws a banner again at the right size, shows it to visitors, and lets ops remove it', async () => {
    const { c, slug } = await ring();
    expect((await put(c, slug, '468x60', await pic(1000, 300, 'jpeg'))).statusCode).toBe(204);
    expect((await put(c, slug, '88x31', await pic(40, 40, 'gif'))).statusCode).toBe(204);
    for (const [kind, w, h] of [['468x60', 468, 60], ['88x31', 88, 31]] as const) {
      const r = await ctx.app.inject({ method: 'GET', url: `/api/v1/rings/${slug}/banner/${kind}` }); // no login: member pages embed it
      expect(r.headers['content-type']).toBe('image/png');
      const m = await sharp(r.rawPayload).metadata();
      expect([m.format, m.width, m.height]).toEqual(['png', w, h]);
    }
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/rings/${slug}/banners` })).json().banners).toHaveLength(2);
    expect((await c.delete(`/api/v1/rings/${slug}/banner/88x31`)).status).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/rings/${slug}/banner/88x31` })).statusCode).toBe(404);
  });

  it('refuses pictures that are not pictures, too big, or from people who do not run the ring', async () => {
    const { c, slug } = await ring();
    expect((await put(c, slug, '468x60', 'not a picture')).statusCode).toBe(400);
    expect((await put(c, slug, '468x60', Buffer.alloc(1024 * 1024 + 10))).statusCode).toBe(413);
    expect((await put(c, slug, '300x300', await pic(10, 10))).statusCode).toBe(400);
    const other = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await put(other, slug, '468x60', await pic(10, 10))).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'PUT', url: `/api/v1/rings/${slug}/banner/468x60`, payload: await pic(10, 10), headers: { origin: ORIGIN, 'content-type': 'application/octet-stream' } })).statusCode).toBe(401);
  });

  it('lets an admin take a banner down with a reason, and restore it', async () => {
    const { c, slug } = await ring();
    await put(c, slug, '468x60', await pic(468, 60));
    const adm = await makeAdmin(ctx);
    expect((await adm.client.post(`/api/v1/rings/${slug}/banner/468x60/hide`, {})).status).toBe(400); // a reason is needed
    expect((await adm.client.post(`/api/v1/rings/${slug}/banner/468x60/hide`, { reason: 'Not suitable' })).status).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/rings/${slug}/banner/468x60` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/rings/${slug}/banners` })).json().banners).toHaveLength(0); // visitors hear of none
    expect((await c.get(`/api/v1/rings/${slug}/banners`)).body.banners[0]).toMatchObject({ kind: '468x60', hidden: true }); // ops see it is hidden
    expect((await ctx.deps.db.query(`SELECT 1 FROM audit_log WHERE action = 'ring.banner_hidden'`)).rowCount).toBe(1);
    expect((await adm.client.post(`/api/v1/rings/${slug}/banner/468x60/restore`, { reason: 'Fixed' })).status).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/rings/${slug}/banner/468x60` })).statusCode).toBe(200);
  });

  it('puts the banners in the export of the people who run the ring', async () => {
    const { u, c, slug } = await ring();
    await put(c, slug, '88x31', await pic(88, 31));
    const r = await c.post('/api/v1/me/export', { password: TEST_PASSWORD });
    await processNext(ctx.deps);
    const dl = await ctx.app.inject({ method: 'GET', url: `/api/v1/me/exports/${r.body.id}/download`, headers: { cookie: `sid=${c.sid}` } });
    const files = unzipSync(new Uint8Array(dl.rawPayload));
    expect(Object.keys(files)).toContain(`rings/${slug}/banner-88x31.png`);
    void u;
  });
});
