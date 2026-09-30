import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';
import { parseCommand } from './console';

describe('parsing a console command', () => {
  it('splits words, quotes and flags', () => {
    expect(parseCommand(`user role zerocool trusted --reason "asked nicely, twice"`)).toEqual({
      words: ['user', 'role', 'zerocool', 'trusted', '--reason', 'asked nicely, twice'], pos: ['user', 'role', 'zerocool', 'trusted'], flags: { reason: 'asked nicely, twice' },
    });
    expect(parseCommand(`announce 'Back soon' --warning --title=Maintenance`).flags).toEqual({ warning: true, title: 'Maintenance' });
    expect(parseCommand(`announce "say \\"hi\\"" --irc`).pos).toEqual(['announce', 'say "hi"']);
  });
});

describe.skipIf(!dbAvailable)('console stats and commands', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const run = (command: string) => admin.client.post('/api/v1/admin/console', { command });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
  });
  afterAll(async () => drop());

  it('records the days people are active, once a day, whichever way they come in', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    await c.get('/api/v1/me');
    await c.get('/api/v1/me');
    await new Promise((r) => setTimeout(r, 50)); // the write is fire-and-forget
    const rows = (await db.query(`SELECT day::text, services FROM activity_days WHERE user_id = $1`, [u.id])).rows;
    expect(rows).toEqual([{ day: new Date(ctx.deps.now()).toISOString().slice(0, 10), services: ['web'] }]);
  });

  it('works out active people, cohorts and the posting heatmap, and gives CSV', async () => {
    // Three people who signed up two weeks ago; two came back last week, one this week.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await makeUser(ctx)).id);
    await db.query(`UPDATE users SET created_at = date_trunc('week', now()) - interval '14 days' + interval '1 hour' WHERE id = ANY($1)`, [ids]);
    await db.query(`INSERT INTO activity_days (user_id, day) SELECT id, (date_trunc('week', now()) - interval '14 days')::date FROM unnest($1::text[]) id`, [ids]);
    await db.query(`INSERT INTO activity_days (user_id, day) VALUES ($1, (date_trunc('week', now()) - interval '6 days')::date), ($2, (date_trunc('week', now()) - interval '5 days')::date), ($3, now()::date) ON CONFLICT DO NOTHING`, ids);
    const s = (await admin.client.get('/api/v1/admin/stats?days=30&weeks=4')).body;
    expect(s.days).toHaveLength(30);
    const today = s.days.at(-1);
    expect(today.dau).toBeGreaterThanOrEqual(2); // the person above, and ids[2]
    expect(today.mau).toBeGreaterThanOrEqual(today.wau);
    const week = s.cohorts.find((c: { size: number; week: string }) => c.size >= 3 && c.active[0] === 3);
    expect(week.active.slice(0, 3)).toEqual([3, 2, 1]);
    expect(s.heatmap).toHaveLength(7);
    expect(s.heatmap[0]).toHaveLength(24);
    expect(Object.keys(s.totals).sort()).toEqual(['files', 'homepages', 'mail_messages', 'posts', 'rings', 'users']);

    const csv = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/stats.csv?kind=cohorts&weeks=4', headers: { cookie: `sid=${admin.client.sid}` } });
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.body.split('\n')[0]).toMatch(/^signup_week,size,week_0,week_1/);
    const heat = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/stats.csv?kind=heatmap', headers: { cookie: `sid=${admin.client.sid}` } });
    expect(heat.body.split('\n')[1]).toMatch(/^Mon,/);
    const u = await loginAs(ctx, (await makeUser(ctx)).handle);
    expect((await u.get('/api/v1/admin/stats')).status).toBe(403);
  });

  it('runs commands through the same core functions, audited twice: the action and the command', async () => {
    const u = await makeUser(ctx, { handle: 'zerocool' });
    expect((await run('help')).body.table.rows.map((r: string[]) => r[0].split(' ')[0])).toContain('user');
    expect((await run('user show zerocool')).body.lines[0]).toContain('zerocool (');
    expect((await run('user role zerocool trusted')).body.error.code).toBe('reason_required');
    expect((await run('user role zerocool wizard --reason "no such role"')).body.error.code).toBe('usage');
    const r = await run('user role zerocool trusted --reason "runs the synth board"');
    expect(r.body.lines).toEqual(['zerocool is now trusted.']);
    expect((await db.query(`SELECT role FROM users WHERE id = $1`, [u.id])).rows[0]!.role).toBe('trusted');
    const log = (await db.query(`SELECT action, origin, after FROM audit_log WHERE action IN ('user.role_changed', 'console.command') ORDER BY id DESC LIMIT 2`)).rows;
    expect(log[0]).toMatchObject({ action: 'console.command', origin: 'console', after: { command: 'user role zerocool trusted --reason "runs the synth board"', outcome: 'ok' } });
    expect(log[1]).toMatchObject({ action: 'user.role_changed', after: { role: 'trusted', reason: 'runs the synth board' } });
    expect((await run('announce "Back in 5 minutes" --title Maintenance --warning')).body.lines).toEqual(['Announced: Maintenance.']);
    expect((await run('frobnicate')).body.error.code).toBe('unknown_command');
    expect((await run('user')).body.error.message).toContain('user show');
    const failed = (await db.query(`SELECT after FROM audit_log WHERE action = 'console.command' ORDER BY id DESC LIMIT 1`)).rows[0]!.after;
    expect(failed).toMatchObject({ command: 'user', outcome: 'error' });
    expect((await run('stats')).body.table.rows.length).toBe(6);
    const specs = (await admin.client.get('/api/v1/admin/console/commands')).body.commands;
    expect(specs.find((c: { name: string }) => c.name === 'vouch confirm')).toMatchObject({ args: ['handle'] });
    // Only admins, and the console can't do more than the buttons: an admin can't change their own role.
    expect((await (await loginAs(ctx, u.handle)).post('/api/v1/admin/console', { command: 'stats' })).status).toBe(403);
    expect((await run(`user role ${admin.handle} user --reason "try it"`)).body.error.code).toBe('cannot_change_own_role');
  });
});
