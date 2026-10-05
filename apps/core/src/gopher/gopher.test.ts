import net, { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from '../test/harness';
import { buildGopherServer } from './server';

describe.skipIf(!dbAvailable)('gopher mirror', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: net.Server;
  let port = 0;
  let thread = '';
  let fileId = '';
  let hiddenId = '';

  // One request: send the selector, read until the server closes.
  const ask = (selector: string | Buffer) => new Promise<Buffer>((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    s.on('data', (c) => chunks.push(c));
    s.on('end', () => resolve(Buffer.concat(chunks)));
    s.on('error', reject);
    s.write(typeof selector === 'string' ? `${selector}\r\n` : selector);
  });
  const menu = async (selector: string) => (await ask(selector)).toString('utf8').split('\r\n');

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    ctx = await makeApp(t.db);
    ctx.deps.config.limits.trusted_board_quota = 5;
    const admin = await makeAdmin(ctx);
    const owner = await makeUser(ctx, { role: 'trusted', handle: 'gopherfan' });
    const c = await loginAs(ctx, owner.handle);
    await c.post('/api/v1/boards', { slug: 'lobby', name: 'Lobby', description: 'Say hi', visibility: 'public' });
    await c.post('/api/v1/boards', { slug: 'secret', name: 'Secret', visibility: 'private' });
    thread = (await c.post('/api/v1/boards/lobby/posts', { subject: 'Hello gopherspace', body: 'First line.\n.a line starting with a dot\n' + 'long '.repeat(40) })).body.id;
    await c.post('/api/v1/boards/lobby/posts', { body: 'A reply', reply_to: thread });
    await c.post('/api/v1/boards/secret/posts', { subject: 'Hidden plans', body: 'nope' });
    await admin.client.post('/api/v1/admin/files/areas', { slug: 'warez', name: 'Shareware' });
    await admin.client.post('/api/v1/admin/files/areas', { slug: 'inner', name: 'Inner', visibility: 'members' });
    const up = (name: string, body: string, area = 'warez') => ctx.app.inject({ method: 'POST', url: `/api/v1/files/areas/${area}/files?name=${name}`, payload: body, headers: { origin: 'https://example.test', cookie: `sid=${c.sid}`, 'content-type': 'application/octet-stream' } });
    fileId = (await up('game.zip', 'PK\u0003\u0004bytes')).json().id;
    hiddenId = (await up('bad.zip', 'bad')).json().id;
    await admin.client.post(`/api/v1/admin/files/${hiddenId}/hide`, { reason: 'not allowed' });
    await up('member.txt', 'members', 'inner');
    await c.put('/api/v1/wiki/site/pages/tea', { title: 'Tea', body: '# Brewing\n\nSee [[Kettles]] and [[Cups|the cups]].\n\n- hot', base_revision: 0, summary: 'first' });
    await c.put('/api/v1/wiki/site/pages/kettles', { title: 'Kettles', body: 'Fill to the line.', base_revision: 0, summary: '' });
    server = buildGopherServer(ctx.deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { server?.close(); await drop(); });

  it('answers the main menu with the site name from config and the right host and port', async () => {
    const lines = await menu('');
    expect(lines[0]).toBe('iTest Site\tfake\t(NULL)\t0');
    expect(lines).toContain('1Boards\t/boards\texample.test\t70');
    expect(lines).toContain('1File areas\t/files\texample.test\t70');
    expect(lines.at(-2)).toBe('.');
  });

  it('lists only public boards, and threads as text documents', async () => {
    const boards = (await menu('/boards')).join('\n');
    expect(boards).toContain('1Lobby (1 threads)\t/boards/lobby');
    expect(boards).not.toContain('Secret');
    const threads = (await menu('/boards/lobby')).join('\n');
    expect(threads).toContain(`0Hello gopherspace - gopherfan, 1 replies`);
    expect(threads).toContain(`\t/boards/lobby/${thread}\t`);
    expect((await menu('/boards/secret')).join('\n')).toContain('3Nothing here.');
  });

  it('sends a thread wrapped to the terminal, with dots escaped and a link to the web', async () => {
    const text = (await ask(`/boards/lobby/${thread}`)).toString('utf8');
    expect(text).toContain('From: gopherfan');
    expect(text).toContain('A reply');
    expect(text).toContain('\r\n..a line starting with a dot\r\n');
    expect(text.split('\r\n').every((l) => [...l].length <= 79)).toBe(true);
    expect(text).toContain(`On the web: https://example.test/boards/lobby/t/${thread}`);
    expect(text.endsWith('\r\n.\r\n')).toBe(true);
  });

  it('lists public file areas and serves files as binary, never hidden ones or members-only areas', async () => {
    const areas = (await menu('/files')).join('\n');
    expect(areas).toContain('1Shareware (1 files)\t/files/warez');
    expect(areas).not.toContain('Inner');
    const list = (await menu('/files/warez')).join('\n');
    expect(list).toContain(`9game.zip - 1 KB\t/files/warez/${fileId}`);
    expect(list).not.toContain('bad.zip');
    expect((await ask(`/files/warez/${fileId}`)).toString('latin1')).toBe('PK\u0003\u0004bytes');
    expect((await menu(`/files/warez/${hiddenId}`)).join('\n')).toContain('3Nothing here.');
    expect((await menu(`/files/inner/${fileId}`)).join('\n')).toContain('3Nothing here.');
  });

  it('refuses nonsense politely and ignores search terms after a tab', async () => {
    expect((await menu('/nope/x/y/z')).join('\n')).toContain('3Nothing here.');
    expect((await menu('/boards\tsearch words'))).toContain('1Lobby (1 threads)\t/boards/lobby\texample.test\t70');
    expect((await ask(Buffer.from('x'.repeat(600)))).toString()).toContain('3That request is too long.');
  });

  it('serves the site wiki as menus: page text, numbered links to follow, and recent changes', async () => {
    expect(await menu('')).toContain('1Wiki\t/wiki\texample.test\t70');
    expect(await menu('/wiki')).toContain('1Tea\t/wiki/tea\texample.test\t70');
    const t = await menu('/wiki/tea');
    expect(t).toContain('iBREWING\tfake\t(NULL)\t0');
    expect(t).toContain('iSee Kettles[1] and the cups[2].\tfake\t(NULL)\t0');
    expect(t).toContain('i- hot\tfake\t(NULL)\t0');
    expect(t).toContain('1[1] Kettles\t/wiki/kettles\texample.test\t70');
    expect(t).toContain('i[2] Cups (no page yet)\tfake\t(NULL)\t0');
    expect((await menu('/wiki/changes')).some((l) => /^1.* Tea - gopherfan, new page\t\/wiki\/tea\t/.test(l))).toBe(true);
    expect((await menu('/wiki/nothing'))[0]).toMatch(/^3Nothing here/);
  });
});
