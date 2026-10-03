import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, makeAdmin, makeApp, makeUser, loginAs, TEST_PASSWORD } from './test/harness';

// Updates and restarts from the console (docs/19), the whole way round: the console asks, the real `sitectl agent` does the job
// (with a stand-in for docker compose), and the console reads back the state and the log.
const sitectl = join(__dirname, '../../../deploy/sitectl');

describe.skipIf(!dbAvailable)('updates and restarts from the console', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let ops: string, calls: string, fake: string;
  const agent = () => execFileSync('bash', [sitectl, 'agent', '--once'], {
    cwd: join(__dirname, '../../../deploy'), encoding: 'utf8',
    env: { ...process.env, SITECTL_OPS_DIR: ops, SITECTL_COMPOSE: `bash ${fake}` },
  });

  beforeAll(async () => {
    let db;
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    ops = mkdtempSync(join(tmpdir(), 'ops-'));
    calls = join(ops, '..', `${ops.split('/').pop()}-calls`);
    fake = join(ops, '..', `${ops.split('/').pop()}-compose`);
    writeFileSync(fake, `echo "$*" >> ${calls}\n`);
  });
  afterAll(async () => { await drop(); });

  it('says plainly when it is not set up on this server', async () => {
    const a = await makeAdmin(ctx);
    expect((await a.client.get('/api/v1/admin/ops')).body).toMatchObject({ configured: false });
    const r = await a.client.post('/api/v1/admin/ops', { action: 'check' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ops_off');
  });

  it('asks, the agent restarts, and the console sees the job done with its log; all audited', async () => {
    ctx.deps.opsDir = ops;
    const a = await makeAdmin(ctx);
    expect((await a.client.post('/api/v1/admin/ops', { action: 'restart', service: 'bbs', password: 'wrong' })).body.error.code).toBe('wrong_password');
    expect((await a.client.post('/api/v1/admin/ops', { action: 'restart', service: 'postgres', password: TEST_PASSWORD })).status).toBe(400);
    expect((await a.client.post('/api/v1/admin/ops', { action: 'restart', password: TEST_PASSWORD })).body.error.code).toBe('bad_service');
    const r = await a.client.post('/api/v1/admin/ops', { action: 'restart', service: 'bbs', password: TEST_PASSWORD });
    expect(r.status).toBe(202);
    const id = r.body.id as string;
    expect(readFileSync(join(ops, 'requests', `${id}.req`), 'utf8')).toBe(`action=restart\nservice=bbs\nby=${a.handle}\nrequested_at=${Math.floor(ctx.deps.now() / 1000)}\n`);
    let s = (await a.client.get('/api/v1/admin/ops')).body;
    expect(s.jobs[0]).toMatchObject({ id, action: 'restart', service: 'bbs', state: 'queued', by: a.handle });
    expect((await a.client.post('/api/v1/admin/ops', { action: 'upgrade', password: TEST_PASSWORD })).body.error.code).toBe('ops_busy');

    agent();
    s = (await a.client.get('/api/v1/admin/ops')).body;
    expect(s.agent.alive).toBe(true);
    expect(s.version.commit).toMatch(/^[0-9a-f]{40}$/); // this repository, as the agent sees it
    expect(s.jobs[0]).toMatchObject({ id, state: 'done' });
    expect(readFileSync(calls, 'utf8')).toContain('restart bbs');
    expect((await a.client.get(`/api/v1/admin/ops/${id}/log`)).body.log).toContain('== done');
    expect((await a.client.get('/api/v1/admin/ops/../../etc/passwd/log')).status).toBe(404);
    const rows = (await ctx.deps.db.query(`SELECT action, target_id, after FROM audit_log WHERE action LIKE 'ops.%'`)).rows;
    expect(rows).toEqual([{ action: 'ops.restart', target_id: id, after: { service: 'bbs' } }]);
    expect(readdirSync(join(ops, 'requests'))).toEqual([]);
    expect((await a.client.post('/api/v1/admin/ops', { action: 'upgrade' })).body.error.code).toBe('wrong_password');
    expect((await a.client.post('/api/v1/admin/ops', { action: 'check' })).status).toBe(202); // no password for a check
  });

  it('is for admins only', async () => {
    const u = await makeUser(ctx);
    const c = await loginAs(ctx, u.handle);
    expect((await c.get('/api/v1/admin/ops')).status).toBe(403);
    expect((await c.post('/api/v1/admin/ops', { action: 'check', password: TEST_PASSWORD })).status).toBe(403);
  });
});
