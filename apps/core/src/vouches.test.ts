import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeAdmin, makeApp, makeUser } from './test/harness';

describe.skipIf(!dbAvailable)('vouching', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let admin: Awaited<ReturnType<typeof makeAdmin>>;
  const person = async (role: 'guest' | 'user' | 'trusted' = 'user') => { const u = await makeUser(ctx, { role, verified: role !== 'guest' }); return { ...u, c: await loginAs(ctx, u.handle) }; };
  const queue = async () => (await admin.client.get('/api/v1/admin/vouches')).body;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db);
    admin = await makeAdmin(ctx);
  });
  afterAll(async () => drop());

  it('only trusted people vouch, for confirmed users who are not trusted yet, once each', async () => {
    const cand = await person(); const plain = await person(); const t1 = await person('trusted'); const guest = await person('guest');
    expect((await plain.c.post('/api/v1/vouches', { handle: cand.handle })).body.error.code).toBe('not_trusted');
    expect((await t1.c.post('/api/v1/vouches', { handle: t1.handle })).body.error.code).toBe('self');
    expect((await t1.c.post('/api/v1/vouches', { handle: guest.handle })).body.error.code).toBe('not_confirmed');
    const t2 = await person('trusted');
    expect((await t1.c.post('/api/v1/vouches', { handle: t2.handle })).body.error.code).toBe('already_trusted');
    expect((await t1.c.post('/api/v1/vouches', { handle: cand.handle, note: 'Runs the synth board well' })).status).toBe(204);
    expect((await t1.c.post('/api/v1/vouches', { handle: cand.handle })).body.error.code).toBe('already_vouched');
    expect((await t1.c.get('/api/v1/me/vouches')).body.vouches).toEqual([expect.objectContaining({ handle: cand.handle, note: 'Runs the synth board well' })]);
  });

  it('lists people in the admin queue with hints, ready once two count, and an admin confirms', async () => {
    const cand = await person(); const t1 = await person('trusted'); const t2 = await person('trusted');
    await t1.c.post('/api/v1/vouches', { handle: cand.handle });
    let row = (await queue()).candidates.find((c: { user: { id: string } }) => c.user.id === cand.id);
    expect(row).toMatchObject({ ready: false, hints: { posts: 0, recent_mod_actions: 0, old_enough: false, enough_posts: false, clean: true } });
    expect((await admin.client.post(`/api/v1/admin/vouches/${cand.id}/confirm`, {})).body.error.code).toBe('not_enough_vouches');
    await t2.c.post('/api/v1/vouches', { handle: cand.handle, note: 'Kind to newcomers' });
    const q = await queue();
    row = q.candidates[0];
    expect(row).toMatchObject({ user: { handle: cand.handle }, ready: true });
    expect(row.vouches.map((v: { voucher: { handle: string } }) => v.voucher.handle)).toEqual([t1.handle, t2.handle]);
    expect(q.needed).toBe(2);
    // Someone else can't confirm.
    expect((await t1.c.post(`/api/v1/admin/vouches/${cand.id}/confirm`, {})).status).toBe(403);
    expect((await admin.client.post(`/api/v1/admin/vouches/${cand.id}/confirm`, {})).status).toBe(204);
    expect((await db.query(`SELECT role FROM users WHERE id = $1`, [cand.id])).rows[0]!.role).toBe('trusted');
    expect((await queue()).candidates.find((c: { user: { id: string } }) => c.user.id === cand.id)).toBeUndefined();
    const actions = (await db.query(`SELECT action, after FROM audit_log WHERE target_id = $1 ORDER BY id`, [cand.id])).rows;
    expect(actions.map((a) => a.action)).toEqual(['vouch.created', 'vouch.created', 'user.role_changed', 'vouch.confirmed']);
    expect(actions[2]!.after.reason).toBe(`vouched for by ${t1.handle} and ${t2.handle}`);
  });

  it('stops counting a vouch when it is withdrawn or the voucher loses trusted', async () => {
    const cand = await person(); const t1 = await person('trusted'); const t2 = await person('trusted');
    await t1.c.post('/api/v1/vouches', { handle: cand.handle });
    await t2.c.post('/api/v1/vouches', { handle: cand.handle });
    await admin.client.post(`/api/v1/admin/users/${t2.id}/role`, { role: 'user', reason: 'stepping back' });
    let row = (await queue()).candidates.find((c: { user: { id: string } }) => c.user.id === cand.id);
    expect(row.ready).toBe(false);
    expect(row.vouches.find((v: { voucher: { id: string } }) => v.voucher.id === t2.id).counts).toBe(false);
    expect((await t1.c.post('/api/v1/vouches/withdraw', { handle: cand.handle })).status).toBe(204);
    expect((await t1.c.post('/api/v1/vouches/withdraw', { handle: cand.handle })).body.error.code).toBe('not_vouched');
    row = (await queue()).candidates.find((c: { user: { id: string } }) => c.user.id === cand.id);
    expect(row.vouches.map((v: { voucher: { id: string } }) => v.voucher.id)).toEqual([t2.id]);
  });

  it('declines with a reason; the vouchers may vouch again later', async () => {
    const cand = await person(); const t1 = await person('trusted');
    await t1.c.post('/api/v1/vouches', { handle: cand.handle });
    expect((await admin.client.post(`/api/v1/admin/vouches/${cand.id}/decline`, {})).status).toBe(400);
    expect((await admin.client.post(`/api/v1/admin/vouches/${cand.id}/decline`, { reason: 'too new' })).status).toBe(204);
    expect((await queue()).candidates.find((c: { user: { id: string } }) => c.user.id === cand.id)).toBeUndefined();
    expect((await t1.c.post('/api/v1/vouches', { handle: cand.handle })).status).toBe(204);
  });

  it('flags the sponsors when someone they vouched for is demoted or suspended soon after', async () => {
    const cand = await person(); const t1 = await person('trusted'); const t2 = await person('trusted');
    await t1.c.post('/api/v1/vouches', { handle: cand.handle });
    await t2.c.post('/api/v1/vouches', { handle: cand.handle });
    await admin.client.post(`/api/v1/admin/vouches/${cand.id}/confirm`, { reason: 'looks good' });
    expect((await admin.client.post(`/api/v1/admin/users/${cand.id}/role`, { role: 'user', reason: 'harassment' })).status).toBe(200);
    // Suspending afterwards doesn't flag the same vouch twice.
    await admin.client.post(`/api/v1/admin/users/${cand.id}/suspend`, { reason: 'harassment' });
    const d = (await admin.client.get(`/api/v1/admin/users/${t1.id}`)).body;
    expect(d.vouching.sponsor_flags).toEqual([expect.objectContaining({ candidate: cand.handle, reason: 'demoted' })]);
    expect((await admin.client.get(`/api/v1/admin/users/${cand.id}`)).body.vouching.vouched_by.map((v: { state: string }) => v.state)).toEqual(['confirmed', 'confirmed']);
    // Next time t1 vouches, admins see the flag beside their name.
    const next = await person();
    await t1.c.post('/api/v1/vouches', { handle: next.handle });
    const row = (await queue()).candidates.find((c: { user: { id: string } }) => c.user.id === next.id);
    expect(row.vouches[0].voucher.flags).toBe(1);
  });

  it('does not flag anyone for a promotion older than the window, or one made without vouching', async () => {
    const cand = await person(); const t1 = await person('trusted'); const t2 = await person('trusted');
    await t1.c.post('/api/v1/vouches', { handle: cand.handle });
    await t2.c.post('/api/v1/vouches', { handle: cand.handle });
    await admin.client.post(`/api/v1/admin/vouches/${cand.id}/confirm`, {});
    await db.query(`UPDATE vouches SET decided_at = now() - interval '91 days' WHERE candidate_id = $1`, [cand.id]);
    await admin.client.post(`/api/v1/admin/users/${cand.id}/suspend`, { reason: 'later trouble' });
    const direct = await person('trusted');
    await admin.client.post(`/api/v1/admin/users/${direct.id}/role`, { role: 'user', reason: 'x' });
    expect((await db.query(`SELECT count(*)::int AS n FROM sponsor_flags WHERE candidate_id = ANY($1)`, [[cand.id, direct.id]])).rows[0]!.n).toBe(0);
  });
});
