import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from '../test/harness';
import { ergoHasPostgres, ircLogin, startErgo, type IrcClientLike, type RunningErgo } from '../test/ergo';
import { EXPORTERS } from '../exports/exporters';
import { ircSecrets } from './secrets';
import { startIrcSync, type IrcSync } from './sync';

const SECRET = 'history-secret-'.padEnd(40, 'h');
const until = async (what: string, f: () => Promise<boolean> | boolean, ms = 10_000) => {
  for (const end = Date.now() + ms; !(await f());) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 100)); }
};

// Q9 (decided 2026-09-30): chat history is kept for irc.history_days in Postgres, a person's own messages
// are in their export, and a deleted account's messages are forgotten at once.
describe.skipIf(!dbAvailable || !ergoHasPostgres)('IRC history', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let ergo: RunningErgo;
  let sync: IrcSync;
  let hist: pg.Client;
  let admin: pg.Client;
  const dbName = `ergo_hist_${Math.random().toString(36).slice(2, 8)}`;
  const connect = async (handle: string): Promise<IrcClientLike> => {
    const c = await loginAs(ctx, handle);
    const r = await ircLogin(ctx.deps.irc!, handle, (await c.post('/api/v1/irc/ticket')).body.ticket);
    if (!r.ok) throw new Error(r.reason);
    return r.client;
  };

  beforeAll(async () => {
    const t = await createTestDb();
    drop = t.drop;
    admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
    const url = new URL(process.env.TEST_DATABASE_URL!); url.pathname = `/${dbName}`;
    ctx = await makeApp(t.db, { irc: { secrets: ircSecrets(SECRET), host: '127.0.0.1', port: 1, apiUrl: 'http://127.0.0.1:1', historyDatabaseUrl: url.toString() } });
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    ergo = await startErgo(ctx.deps.config, { coreUrl: `http://127.0.0.1:${(ctx.app.server.address() as { port: number }).port}`, secret: SECRET, historyDatabaseUrl: url.toString() });
    Object.assign(ctx.deps.irc!, { host: ergo.irc.host, port: ergo.irc.port, apiUrl: ergo.irc.apiUrl });
    sync = startIrcSync(ctx.deps, () => undefined, { tickMs: 3_600_000, presenceMs: 3_600_000 });
    await until('the bot', () => sync.bot.ready);
    await sync.runNow({ full: true });
    hist = new pg.Client({ connectionString: url.toString() });
    await hist.connect();
  }, 60_000);
  afterAll(async () => { sync?.stop(); await ergo?.stop(); await hist?.end(); await admin?.query(`DROP DATABASE IF EXISTS ${dbName}`); await admin?.end(); await drop(); });

  it('exports a person their own channel and direct messages, and nobody else’s', async () => {
    const a = await makeUser(ctx); const b = await makeUser(ctx);
    const ca = await connect(a.handle); const cb = await connect(b.handle);
    ca.join('#lobby'); cb.join('#lobby');
    await new Promise((r) => setTimeout(r, 600));
    ca.say('#lobby', 'hello channel, from a');
    ca.say(b.handle, 'a private word, from a');
    cb.say(a.handle, 'a reply, from b');
    cb.say('#lobby', 'b in the channel');
    await until('the messages to be stored', async () => Number((await hist.query(`SELECT count(*) FROM history`)).rows[0].count) > 0 && (await hist.query(`SELECT 1 FROM account_messages WHERE convert_from(account, 'UTF8') = $1`, [b.handle])).rowCount! >= 2);
    const files: Record<string, string> = {};
    const u = (await ctx.deps.db.query(`SELECT * FROM users WHERE id = $1`, [a.id])).rows[0];
    await EXPORTERS.find((e) => e.id === 'irc')!.run({ deps: ctx.deps, user: u, add: (p: string, d: string | Buffer) => { files[p] = d.toString(); } } as never);
    const msgs = JSON.parse(files['irc/messages.json']!) as { to: string; text: string; kind: string; at: string }[];
    expect(msgs.map((m) => `${m.to}: ${m.text}`)).toEqual(['#lobby: hello channel, from a', `${b.handle}: a private word, from a`]);
    expect(msgs[0]).toMatchObject({ kind: 'message' });
    expect(Date.parse(msgs[0]!.at)).toBeGreaterThan(Date.now() - 60_000);
    ca.quit(); cb.quit();
  }, 30_000);

  it('forgets a deleted account’s messages at once', async () => {
    const a = await makeUser(ctx);
    const ca = await connect(a.handle);
    ca.join('#lobby');
    await new Promise((r) => setTimeout(r, 500));
    ca.say('#lobby', 'soon to be forgotten');
    const count = async () => (await hist.query(`SELECT count(*)::int AS n FROM account_messages WHERE convert_from(account, 'UTF8') = $1`, [a.handle])).rows[0].n as number;
    await until('the message to be stored', async () => (await count()) > 0);
    ca.quit();
    const ad = await makeAdmin(ctx);
    expect((await ad.client.post(`/api/v1/admin/users/${a.id}/delete`, { posts: 'keep', reason: 'asked to leave' })).status).toBe(204);
    const r = await sync.runNow();
    expect(r?.failures).toEqual([]);
    await until('Ergo to forget the messages', async () => (await count()) === 0, 15_000);
  }, 40_000);
});
