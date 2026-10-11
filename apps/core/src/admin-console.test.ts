import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

// The admin console's tables and records (docs/11): audit filters and CSV, the op picker, the boards table.
describe.skipIf(!dbAvailable)('admin console', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { ({ db, drop } = await createTestDb()); ctx = await makeApp(db); });
  afterAll(async () => drop());

  it('filters the audit log by a handle, and exports it as CSV that spreadsheets cannot run', async () => {
    const admin = await makeAdmin(ctx, 'auditor');
    const u = await makeUser(ctx, { handle: 'pip' });
    await admin.client.post(`/api/v1/admin/users/${u.id}/role`, { role: 'trusted', reason: '=HYPERLINK("x"), "quoted", and a comma' });
    const byHandle = (await admin.client.get('/api/v1/admin/audit?actor=@auditor&action=user.role_changed')).body.entries;
    expect(byHandle).toHaveLength(1);
    expect((await admin.client.get('/api/v1/admin/audit?actor=nobody-here')).body.entries).toHaveLength(0);
    const csv = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/audit.csv?action=user.*', headers: { cookie: `sid=${admin.client.sid}` } });
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.body.trim().split('\r\n');
    expect(lines[0]).toBe('id,at,actor,actor_kind,action,target_type,target_id,target,origin,reason');
    const row = lines.find((l) => l.includes('user.role_changed'))!;
    expect(row).toContain('"\'=HYPERLINK(""x""), ""quoted"", and a comma"'); // quoted, and the formula neutralised
    expect(row).toContain('"pip"');
    const noted = (await db.query(`SELECT after FROM audit_log WHERE action = 'audit.exported'`)).rows[0]!;
    expect(noted.after).toMatchObject({ count: expect.any(Number), filters: { action: 'user.*' } });
    // Not for anyone else.
    const user = await makeUser(ctx);
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/audit.csv' });
    expect(res.statusCode).toBe(401);
    void user;
  });

  it('finds op targets by name and pages the boards table; a board can be handed to someone, audited', async () => {
    const admin = await makeAdmin(ctx, 'boss');
    const names = ['Apple pies', 'Banana bread', 'Cherry tarts'];
    const ids: string[] = [];
    for (const [i, name] of names.entries()) ids.push((await admin.client.post('/api/v1/boards', { slug: `bake${i}`, name, visibility: i === 2 ? 'private' : 'public' })).body.id);
    expect((await admin.client.get('/api/v1/admin/ops/targets?scope=board&q=banana')).body.targets).toEqual([{ id: ids[1], label: 'Banana bread (bake1)' }]);
    expect((await admin.client.get('/api/v1/admin/ops/targets?scope=mud')).body.targets).toEqual([{ id: 'world', label: 'world' }]);

    const first = (await admin.client.get('/api/v1/admin/boards?q=bake&limit=2')).body;
    expect(first.boards.map((b: { name: string }) => b.name)).toEqual(['Apple pies', 'Banana bread']);
    const second = (await admin.client.get(`/api/v1/admin/boards?q=bake&limit=2&before=${first.next}`)).body;
    expect(second.boards.map((b: { name: string; visibility: string }) => [b.name, b.visibility])).toEqual([['Cherry tarts', 'private']]); // private ones too
    expect(second.next).toBeNull();

    const heir = await makeUser(ctx, { handle: 'heir' });
    expect((await admin.client.post(`/api/v1/admin/boards/${ids[2]}/owner`, { handle: 'heir' })).status).toBe(400); // needs a reason
    expect((await admin.client.post(`/api/v1/admin/boards/${ids[2]}/owner`, { handle: 'ghost', reason: 'owner left' })).status).toBe(404);
    expect((await admin.client.post(`/api/v1/admin/boards/${ids[2]}/owner`, { handle: '@heir', reason: 'owner left' })).status).toBe(204);
    expect((await admin.client.get('/api/v1/admin/boards?q=cherry')).body.boards[0].owner).toBe('heir');
    const entry = (await db.query(`SELECT after FROM audit_log WHERE action = 'board.owner_changed' AND target_id = $1`, [ids[2]])).rows[0]!;
    expect(entry.after).toEqual({ owner_id: heir.id, reason: 'owner left' });
    // The new owner can get into their private board.
    expect((await db.query(`SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2`, [ids[2], heir.id])).rowCount).toBe(1);
  });

  it('manages board categories: add, rename, reorder, file a board, delete (its boards go unfiled)', async () => {
    const admin = await makeAdmin(ctx, 'sorter');
    const a = (await admin.client.post('/api/v1/admin/board-categories', { name: 'Alpha' })).body.id as string;
    const b = (await admin.client.post('/api/v1/admin/board-categories', { name: 'Beta' })).body.id as string;
    const order = async () => (await admin.client.get('/api/v1/boards')).body.categories.map((c: { name: string }) => c.name).filter((n: string) => ['Alpha', 'Beta', 'Alpha2'].includes(n));
    expect(await order()).toEqual(['Alpha', 'Beta']);
    expect((await admin.client.post(`/api/v1/admin/board-categories/${b}/move`, { direction: 'up' })).status).toBe(204);
    expect(await order()).toEqual(['Beta', 'Alpha']);
    expect((await admin.client.patch(`/api/v1/admin/board-categories/${a}`, { name: 'Beta' })).status).toBe(409);
    expect((await admin.client.patch(`/api/v1/admin/board-categories/${a}`, { name: 'Alpha2' })).status).toBe(204);
    const board = (await admin.client.post('/api/v1/boards', { slug: 'filed', name: 'Filed board', visibility: 'public' })).body;
    expect((await admin.client.patch('/api/v1/boards/filed', { category_id: a })).body.category?.name).toBe('Alpha2');
    expect((await admin.client.get('/api/v1/admin/boards?q=filed')).body.boards[0].category_id).toBe(a);
    expect((await admin.client.delete(`/api/v1/admin/board-categories/${a}`)).status).toBe(204);
    expect((await admin.client.get('/api/v1/boards/filed')).body.category).toBeNull();
    const actions = (await db.query(`SELECT action FROM audit_log WHERE action LIKE 'board.category_%' AND target_id = $1 ORDER BY id`, [a])).rows.map((r) => r.action);
    expect(actions).toEqual(['board.category_created', 'board.category_renamed', 'board.category_deleted']);
    const user = await makeUser(ctx);
    const c = await loginAs(ctx, user.handle);
    expect((await c.delete(`/api/v1/admin/board-categories/${b}`)).status).toBeGreaterThanOrEqual(401);
    void board;
  });
});
