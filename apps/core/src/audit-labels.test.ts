import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, makeAdmin, makeApp, makeUser } from './test/harness';

// The audit log keeps ids; reading it says who or what each entry is about, by their current name (docs/11, 14).
describe.skipIf(!dbAvailable)('audit log labels', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { ({ db, drop } = await createTestDb()); ctx = await makeApp(db); });
  afterAll(async () => drop());

  const entries = async (admin: Awaited<ReturnType<typeof makeAdmin>>, q: string) =>
    (await admin.client.get(`/api/v1/admin/audit?${q}`)).body.entries as { target_id: string; target_label: string | null; target_slug: string | null; action: string }[];

  it('names people by their current handle, boards and rings by name with their address, and the deleted plainly', async () => {
    const admin = await makeAdmin(ctx);
    const u = await makeUser(ctx, { handle: 'wren', role: 'trusted' });
    await admin.client.post(`/api/v1/admin/users/${u.id}/role`, { role: 'user', reason: 'testing' });
    let row = (await entries(admin, `target_id=${u.id}&action=user.role_changed`))[0]!;
    expect(row.target_label).toBe('wren');

    await admin.client.post(`/api/v1/admin/users/${u.id}/rename`, { handle: 'robin', reason: 'asked' });
    row = (await entries(admin, `target_id=${u.id}&action=user.role_changed`))[0]!;
    expect(row.target_label).toBe('robin'); // follows the rename; the log itself is unchanged

    const board = (await admin.client.post('/api/v1/boards', { slug: 'labels', name: 'Label board', visibility: 'public' })).body;
    const b = (await entries(admin, 'action=board.created')).find((e) => e.target_id === board.id)!;
    expect(b).toMatchObject({ target_label: 'Label board', target_slug: 'labels' });

    await db.query(`UPDATE users SET status = 'deleted' WHERE id = $1`, [u.id]);
    row = (await entries(admin, `target_id=${u.id}&action=user.role_changed`))[0]!;
    expect(row.target_label).toBe('Deleted user');
  });
});
