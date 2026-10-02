import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser, TEST_PASSWORD } from './test/harness';
import { processNext } from './exports/service';

describe.skipIf(!dbAvailable)('chat and MUD client settings on the account', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let c: Awaited<ReturnType<typeof loginAs>>;
  let id: string;
  const mud = {
    aliases: [{ id: 'a1', pattern: 'k', match: 'start', send: 'kill $1' }],
    triggers: [{ id: 't1', pattern: 'You are hungry', actions: [{ type: 'send', text: 'eat bread' }, { type: 'highlight', colour: 'yellow' }] }],
    buttons: [{ id: 'b1', label: 'Look', send: 'look' }],
    options: { separator: ';' },
  };

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    const u = await makeUser(ctx);
    id = u.id;
    c = await loginAs(ctx, u.handle);
  });
  afterAll(async () => drop());

  it('starts with defaults, keeps what is saved, and fills in defaults for anything left out', async () => {
    const empty = (await c.get('/api/v1/me/client-settings/mud')).body.settings;
    expect(empty).toMatchObject({ aliases: [], triggers: [], options: { separator: ';', speedwalk: true, numpad: true } });
    const r = await c.put('/api/v1/me/client-settings/mud', { settings: mud });
    expect(r.status).toBe(200);
    const got = (await c.get('/api/v1/me/client-settings/mud')).body.settings;
    expect(got.aliases[0]).toMatchObject({ pattern: 'k', send: 'kill $1', enabled: true });
    expect(got.triggers[0].actions).toHaveLength(2);
    expect(got.options.echo).toBe(true);
    expect((await c.put('/api/v1/me/client-settings/chat', { settings: { ignore: ['spammer'], highlights: ['synth'] } })).status).toBe(200);
  });

  it('refuses rules that are not in the fixed set, unknown clients, and strangers', async () => {
    const bad = await c.put('/api/v1/me/client-settings/mud', { settings: { triggers: [{ id: 't2', pattern: 'x', actions: [{ type: 'eval', code: 'alert(1)' }] }] } });
    expect(bad.status).toBe(400);
    expect((await c.get('/api/v1/me/client-settings/other')).status).toBe(400);
    expect((await client(ctx.app).get('/api/v1/me/client-settings/mud')).status).toBe(401);
  });

  it('is in the export, and goes with the account', async () => {
    expect((await c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [id])).rows[0]!;
    const files = unzipSync(new Uint8Array(readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`))));
    expect(JSON.parse(strFromU8(files['mud/client.json']!)).aliases[0].send).toBe('kill $1');
    expect(JSON.parse(strFromU8(files['chat/client.json']!)).ignore).toEqual(['spammer']);
    expect((await c.post('/api/v1/me/delete', { password: TEST_PASSWORD, confirm_handle: (await c.get('/api/v1/me')).body.user.handle, posts: 'keep' })).status).toBeLessThan(300);
    expect((await db.query(`SELECT count(*)::int AS n FROM client_settings WHERE user_id = $1`, [id])).rows[0]!.n).toBe(0);
  });
});
