import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, loginAs, makeApp, makeUser } from './test/harness';

// Where you are signed in (docs/02): the list, and signing out of one place or every other one, audited.
describe.skipIf(!dbAvailable)('sessions', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { ({ db, drop } = await createTestDb()); ctx = await makeApp(db); });
  afterAll(async () => drop());

  it('lists live sessions with this one first, signs out another, then every other one', async () => {
    const u = await makeUser(ctx);
    const here = await loginAs(ctx, u.handle);
    const phone = await loginAs(ctx, u.handle);
    const laptop = await loginAs(ctx, u.handle);
    const list = (await here.get('/api/v1/me/sessions')).body.sessions as { id: string; current: boolean; kind: string }[];
    expect(list).toHaveLength(3);
    expect(list[0]!.current).toBe(true);
    expect(list.filter((s) => s.current)).toHaveLength(1);

    // This session can't be ended from here (that is Log out), and nobody else's can be touched.
    expect((await here.delete(`/api/v1/me/sessions/${list[0]!.id}`)).status).toBe(400);
    const other = await makeUser(ctx);
    const theirs = await loginAs(ctx, other.handle);
    expect((await theirs.delete(`/api/v1/me/sessions/${list[1]!.id}`)).status).toBe(404);

    const phoneId = (await phone.get('/api/v1/me/sessions')).body.sessions.find((s: { current: boolean }) => s.current).id;
    expect((await here.delete(`/api/v1/me/sessions/${phoneId}`)).status).toBe(204);
    expect((await phone.get('/api/v1/me')).status).toBe(401);
    expect((await laptop.get('/api/v1/me')).status).toBe(200);

    expect((await here.post('/api/v1/me/sessions/revoke-others')).body).toEqual({ revoked: 1 });
    expect((await laptop.get('/api/v1/me')).status).toBe(401);
    expect((await here.get('/api/v1/me')).status).toBe(200);
    expect((await here.get('/api/v1/me/sessions')).body.sessions).toHaveLength(1);

    const actions = (await db.query(`SELECT action, after FROM audit_log WHERE target_id = $1 AND action LIKE 'user.session%' ORDER BY id`, [u.id])).rows;
    expect(actions.map((a) => a.action)).toEqual(['user.session_revoked', 'user.sessions_revoked']);
    expect(actions[1]!.after).toEqual({ count: 1 });
  });
});
