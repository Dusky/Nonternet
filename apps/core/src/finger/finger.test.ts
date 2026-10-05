import net, { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from '../test/harness';
import { buildFingerServer } from './server';

// finger (docs/05): a person's public profile and .plan, nothing more; nobody listed by name; no forwarding.
describe.skipIf(!dbAvailable)('finger', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: net.Server;
  let port = 0;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];

  const ask = (q: string | Buffer) => new Promise<string>((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    const chunks: Buffer[] = [];
    s.on('data', (c) => chunks.push(c));
    s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    s.on('error', reject);
    s.write(typeof q === 'string' ? `${q}\r\n` : q);
  });

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop; db = t.db;
    ctx = await makeApp(t.db);
    const ada = await makeUser(ctx, { handle: 'ada' });
    const c = await loginAs(ctx, ada.handle);
    // Saving a plan refuses terminal escapes; one already in the database (say, from before the rule) is stripped on the way out.
    expect((await c.patch('/api/v1/me', { plan: 'hi \u001b[31mred' })).status).toBe(400);
    expect((await c.patch('/api/v1/me', { display_name: 'Ada L', status_line: 'counting', plan: `Working on the engine.\n${'word '.repeat(30)}` })).status).toBe(200);
    await db.query(`UPDATE users SET plan = plan || E'\n\x1b[31mred?\x1b[0m' WHERE id = $1`, [ada.id]);
    await makeUser(ctx, { handle: 'newbie', role: 'guest' });
    const gone = await makeUser(ctx, { handle: 'banned' });
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [gone.id]);
    await makeUser(ctx, { handle: 'quiet' });
    server = buildFingerServer(ctx.deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { server?.close(); await drop(); });

  it('answers a handle with the public profile and plan, wrapped and without control characters', async () => {
    const out = await ask('ada');
    expect(out).toContain('Ada L (ada) on Test Site\r\n');
    expect(out).toContain('counting');
    expect(out).toContain('Profile: https://example.test/people/ada');
    expect(out).toContain('Plan:\r\nWorking on the engine.');
    expect(out).not.toContain('\u001b');
    expect(out).toContain('[31mred?'); // the escape is gone, the harmless rest stays
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThanOrEqual(79);
    expect(await ask('/W ADA')).toContain('Ada L (ada)'); // verbose flag and any case
  });

  it('says plainly when there is no plan, and has nothing for guests, suspended or unknown people', async () => {
    expect(await ask('quiet')).toContain('No plan.');
    for (const who of ['newbie', 'banned', 'nobody']) expect(await ask(who)).toBe(`Nobody here goes by "${who}".\r\n`);
  });

  it('lists nobody by name, refuses forwarding, junk and long requests', async () => {
    const list = await ask('');
    expect(list).toContain('Test Site');
    expect(list).not.toMatch(/\bada\b/);
    expect(await ask('ada@elsewhere.example')).toContain('does not pass requests on');
    expect(await ask('rm -rf /')).toContain('That is not a handle');
    expect(await ask(Buffer.from('x'.repeat(600)))).toContain('too long');
  });
});
