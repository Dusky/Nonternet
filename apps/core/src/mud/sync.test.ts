import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser, SITE_YAML } from '../test/harness';
import { evenniaAvailable, mudConnect, startEvennia, type RunningMud } from '../test/evennia';
import { mudSecrets } from './secrets';
import { mudExport, mudStatus, pushAccounts, sendMudAnnouncements } from './sync';
import { EXPORTERS, type ExportUser } from '../exports/exporters';

const SECRET = 'mud-sync-test-secret-0123456789abcdefghijk';
const until = async (what: string, fn: () => boolean | Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 50)); }
};

describe.skipIf(!dbAvailable || !evenniaAvailable)('the MUD, through a real Evennia', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let mud: RunningMud;
  const ticket = async (handle: string) => (await (await loginAs(ctx, handle)).post('/api/v1/mud/ticket')).body.ticket as string;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db, { mud: { secrets: mudSecrets(SECRET), url: 'http://127.0.0.1:1' } });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    mud = await startEvennia({ coreUrl: `http://127.0.0.1:${(ctx.app.server.address() as { port: number }).port}`, secret: SECRET, siteYaml: SITE_YAML() });
    ctx.deps.mud!.url = mud.url;
  }, 180_000);
  afterAll(async () => { await mud?.stop(); await drop(); }, 60_000);

  it('lets someone in with a ticket from core, once, and not with a wrong password', async () => {
    const u = await makeUser(ctx);
    const t = await ticket(u.handle);
    const a = await mudConnect(mud.wsPort, u.handle, t);
    expect(a.ok, a.texts.join('\n')).toBe(true);
    a.close();
    expect((await mudConnect(mud.wsPort, u.handle, t)).ok).toBe(false);
    expect((await mudConnect(mud.wsPort, u.handle, 'nope nope nope')).ok).toBe(false);
    const guest = await makeUser(ctx, { role: 'guest', verified: false });
    expect((await mudConnect(mud.wsPort, guest.handle, 'anything at all')).ok).toBe(false);
  }, 60_000);

  it('shows who is playing, and disconnects someone the moment they are suspended', async () => {
    const u = await makeUser(ctx);
    const s = await mudConnect(mud.wsPort, u.handle, await ticket(u.handle));
    expect(s.ok, s.texts.join('\n')).toBe(true);
    const st = await mudStatus(ctx.deps);
    expect(st.name).toBe('Test Site');
    expect(st.sessions.map((x) => x.account)).toContain(u.handle);
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]);
    expect((await pushAccounts(ctx.deps)).disconnected).toBeGreaterThanOrEqual(1);
    await until('the disconnect', () => s.closed());
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [u.id]);
  }, 60_000);

  it('follows a rename and a promotion to admin', async () => {
    const u = await makeUser(ctx);
    (await mudConnect(mud.wsPort, u.handle, await ticket(u.handle))).close();
    await db.query(`UPDATE users SET handle = $2, role = 'admin' WHERE id = $1`, [u.id, `${u.handle}z`]);
    const r = await pushAccounts(ctx.deps);
    expect(r).toMatchObject({ renamed: 1, roles: 1 });
    expect((await pushAccounts(ctx.deps))).toMatchObject({ renamed: 0, roles: 0 }); // nothing left to do
  }, 60_000);

  it('puts a person’s characters in their export, and deleting the account removes them', async () => {
    const u = await makeUser(ctx);
    const s = await mudConnect(mud.wsPort, u.handle, await ticket(u.handle));
    await until('the welcome', () => s.texts.some((t) => t.includes('You have no character yet'))); // someone new is told how to start
    await new Promise((r) => setTimeout(r, 500)); // let the login finish, as a person typing would
    s.send('charcreate');
    const plain = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, ''); // menus carry ANSI codes even in raw mode
    await until('the character sheet', () => s.texts.some((t) => plain(t).includes('Accept and create character'))).catch((e) => { throw new Error(`${e.message}: ${s.texts.slice(2).join(' // ').replace(/\n/g, ' ⏎ ')} closed=${s.closed()}`); });
    s.send('3');
    await until('the new character', () => s.texts.some((t) => /is ready/.test(t)));
    const files: Record<string, string> = {};
    const mudExporter = EXPORTERS.find((e) => e.id === 'mud')!;
    await mudExporter.run({ deps: ctx.deps, user: { id: u.id } as ExportUser, add: (p, d) => { files[p] = String(d); } });
    const out = JSON.parse(files['mud/characters.json']!);
    expect(out.account).toBe(u.handle);
    expect(out.characters).toHaveLength(1);
    expect(out.characters[0].location).toBe('Town square');
    expect(out.characters[0].carrying.length).toBeGreaterThan(0);
    s.close();
    await db.query(`UPDATE users SET status = 'deleted' WHERE id = $1`, [u.id]);
    expect((await pushAccounts(ctx.deps)) as unknown as { deleted: number }).toMatchObject({ deleted: 1 });
    expect((await mudExport(ctx.deps, u.id)).characters).toEqual([]);
  }, 60_000);

  it('sends an announcement to everyone playing, once, and the console can see the MUD', async () => {
    const u = await makeUser(ctx);
    const s = await mudConnect(mud.wsPort, u.handle, await ticket(u.handle));
    const admin = await makeAdmin(ctx);
    expect((await admin.client.post('/api/v1/admin/announcements', { title: 'Server restart', body: 'In ten minutes.', mud: true })).status).toBe(201);
    expect(await sendMudAnnouncements(ctx.deps)).toBe(1);
    await until('the announcement', () => s.texts.some((t) => t.includes('Server restart: In ten minutes.')));
    expect(await sendMudAnnouncements(ctx.deps)).toBe(0);
    const o = (await admin.client.get('/api/v1/admin/mud')).body;
    expect(o).toMatchObject({ configured: true, reachable: true });
    expect(o.status.counts.accounts).toBeGreaterThan(1);
    s.close();
  }, 60_000);
});
