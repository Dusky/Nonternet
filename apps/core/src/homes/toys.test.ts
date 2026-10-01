import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { buttonPng, buttonSvg, parseButton } from './toys';
import { widgetScript } from './widget-scripts';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from '../test/harness';

describe('the 88x31 button maker', () => {
  it('draws two lines of text in two colours as plain SVG', () => {
    const svg = buttonSvg(parseButton({ text: 'MADE BY|HAND', fg: '#ffee58', bg: '37474F' }));
    expect(svg).toContain('width="88" height="31"');
    expect(svg).toContain('fill="#37474f"');
    expect(svg).toContain('>MADE BY<');
    expect(svg).not.toMatch(/<script|href=|\son\w+=|<image|<foreignObject/i);
  });
  it('escapes anything markup-like, and refuses bad text and colours', () => {
    expect(buttonSvg(parseButton({ text: '<b>&"\'' }))).not.toContain('<b>');
    expect(() => parseButton({ text: '' })).toThrow();
    expect(() => parseButton({ text: 'a|b|c' })).toThrow();
    expect(() => parseButton({ text: 'x'.repeat(15) })).toThrow();
    expect(() => parseButton({ text: 'ok', fg: 'red' })).toThrow();
    expect(() => parseButton({ text: 'new\nline' })).toThrow();
  });
  it('makes a PNG of the same size', async () => {
    const meta = await sharp(await buttonPng(parseButton({ text: 'HELLO' }))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 88, 31]);
  });
});

describe('counter styles', () => {
  it('are chosen with data-style and fall back to the default look', () => {
    const src = widgetScript('counter')!;
    for (const name of ['odometer', 'lcd', 'amber', 'plain']) expect(src).toContain(`${name}:`);
    expect(src).toContain("getAttribute('data-style')");
  });
});

describe.skipIf(!dbAvailable)('signing a guestbook with your account', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());
  const homeFor = (handle: string) => `https://${handle.toLowerCase()}.example-homes.test/`;
  const widgetSign = (handle: string, body: object) => ctx.app.inject({ method: 'POST', url: `/api/v1/widgets/${handle}/guestbook`, payload: body as object, headers: { origin: homeFor(handle) } });
  async function homepage(handle: string) {
    const u = await makeUser(ctx, { handle });
    const c = await loginAs(ctx, handle);
    await ctx.app.inject({ method: 'PUT', url: '/api/v1/homes/me/file?path=index.html', payload: '<h1>hi</h1>', headers: { origin: 'https://example.test', cookie: `sid=${c.sid}`, 'content-type': 'text/plain' } });
    return { ...u, c };
  }
  const passOf = (redirect: string) => new URL(redirect).hash.replace('#gbticket=', '');

  it('gives a signed-in visitor a one-use pass, and the entry carries their handle', async () => {
    const home = await homepage('tickhome'); const visitor = await homepage('tickvisitor');
    const r = await visitor.c.post('/api/v1/homes/tickhome/guestbook-ticket', { return_to: `${homeFor('tickhome')}guestbook.html` });
    expect(r.status).toBe(200);
    expect(r.body.redirect).toMatch(/^https:\/\/tickhome\.example-homes\.test\/guestbook\.html#gbticket=/);
    const ticket = passOf(r.body.redirect);
    const signed = await widgetSign('tickhome', { message: 'Lovely page', ticket });
    expect(signed.statusCode).toBe(201);
    const row = (await ctx.deps.db.query(`SELECT author_id, name FROM guestbook_entries WHERE message = 'Lovely page'`)).rows[0];
    expect(row).toMatchObject({ author_id: visitor.id });
    const again = await widgetSign('tickhome', { message: 'Second try', ticket });
    expect(again.statusCode).toBe(400);
    expect(JSON.parse(again.body).error.code).toBe('bad_ticket');
    void home;
  });

  it('will not send anyone to another address, hand out a pass for the wrong homepage, or accept an old pass', async () => {
    await homepage('tickone'); await homepage('ticktwo'); const v = await homepage('tickguest2');
    expect((await v.c.post('/api/v1/homes/tickone/guestbook-ticket', { return_to: 'https://evil.example/' })).body.error.code).toBe('bad_return');
    expect((await v.c.post('/api/v1/homes/tickone/guestbook-ticket', { return_to: 'javascript:alert(1)' })).status).toBe(400);
    expect((await v.c.post('/api/v1/homes/tickone/guestbook-ticket', { return_to: `${homeFor('ticktwo')}` })).body.error.code).toBe('bad_return');
    const pass = passOf((await v.c.post('/api/v1/homes/tickone/guestbook-ticket', { return_to: homeFor('tickone') })).body.redirect);
    // A pass for one homepage does nothing on another.
    expect((await widgetSign('ticktwo', { message: 'wrong place', ticket: pass })).statusCode).toBe(400);
    await ctx.deps.db.query(`UPDATE guestbook_tickets SET expires_at = now() - interval '1 minute'`);
    expect((await widgetSign('tickone', { message: 'too late', ticket: pass })).statusCode).toBe(400);
    expect((await ctx.deps.db.query(`SELECT 1 FROM guestbook_entries WHERE message IN ('wrong place', 'too late')`)).rowCount).toBe(0);
  });

  it('needs a signed-in, confirmed person to ask for a pass', async () => {
    await homepage('tickthree');
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/homes/tickthree/guestbook-ticket', payload: { return_to: homeFor('tickthree') }, headers: { origin: 'https://example.test' } })).statusCode).toBe(401);
  });
});
