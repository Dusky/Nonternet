import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable } from './test/harness';
import { grantRuntimeRole } from './migrate';

// Production runs core as a role that cannot rewrite history (docs/15): it can do everything core does,
// but UPDATE, DELETE and TRUNCATE on audit_log are refused by the database's permissions, not just a trigger.
describe.skipIf(!dbAvailable)('the runtime database role', () => {
  it('can read and write the tables, add to the audit log, and not change or remove it', async () => {
    const { db, url, drop } = await createTestDb();
    const role = `core_rt_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await grantRuntimeRole(db, role, 'rt-password-1');
      await grantRuntimeRole(db, role, 'rt-password-2'); // again: idempotent, and the password can change
      const u = new URL(url); u.username = role; u.password = 'rt-password-2';
      const c = new pg.Client({ connectionString: u.toString() });
      await c.connect();
      try {
        await c.query(`INSERT INTO users (id, handle, email, password_hash) VALUES ('u_01HZZZZZZZZZZZZZZZZZZZZZZZ', 'rt', 'rt@example.test', 'x')`);
        await c.query(`UPDATE users SET bio = 'hi' WHERE handle = 'rt'`);
        await c.query(`INSERT INTO audit_log (actor_kind, action, origin) VALUES ('system', 'test.written', 'system')`);
        expect((await c.query(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n).toBeGreaterThan(0);
        for (const sql of [`UPDATE audit_log SET action = 'x'`, `DELETE FROM audit_log`, `TRUNCATE audit_log`, `INSERT INTO schema_migrations (name) VALUES ('evil.sql')`]) {
          await expect(c.query(sql), sql).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
        }
      } finally { await c.end(); }
    } finally {
      await db.query(`REASSIGN OWNED BY ${role} TO CURRENT_USER`).catch(() => undefined);
      await db.query(`DROP OWNED BY ${role}`).catch(() => undefined);
      await drop();
      const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      await admin.connect();
      await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => undefined);
      await admin.end();
    }
  });
});
