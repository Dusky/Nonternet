import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db';

// Forward-only SQL migrations, applied in file-name order inside one transaction each.
// In the bundle the .sql files sit next to main.cjs; from source they sit in ./migrations.
const dir = typeof __dirname !== 'undefined' ? join(__dirname, 'migrations') : fileURLToPath(new URL('./migrations', import.meta.url));

export async function migrate(db: Db, log: (msg: string) => void = () => undefined): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    await db.tx(async (q) => {
      // Advisory lock so two starting instances never apply the same migration twice.
      await q.query('SELECT pg_advisory_xact_lock(724001)');
      const done = await q.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount > 0) return;
      await q.query(readFileSync(join(dir, file), 'utf8'));
      await q.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.push(file);
      log(`applied migration ${file}`);
    });
  }
  return applied;
}

// Production runs core as a role that cannot change the audit log (docs/15): the owner applies migrations,
// then grants the runtime role what core needs on every table, and takes back UPDATE, DELETE and TRUNCATE on
// audit_log. Idempotent; run after every migration pass so new tables are covered.
export async function grantRuntimeRole(db: Db, role: string, password?: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('DB_RUNTIME_ROLE must be a lowercase SQL name');
  await db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(724002)');
    const exists = (await q.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount;
    if (!exists) {
      if (!password) throw new Error(`the role ${role} does not exist; set DB_RUNTIME_PASSWORD so core can make it`);
      await q.query(`CREATE ROLE ${role} LOGIN PASSWORD ${quoteLiteral(password)}`);
    } else if (password) {
      await q.query(`ALTER ROLE ${role} LOGIN PASSWORD ${quoteLiteral(password)}`);
    }
    await q.query(`GRANT CONNECT ON DATABASE ${quoteIdent((await q.query<{ d: string }>('SELECT current_database() AS d')).rows[0]!.d)} TO ${role}`);
    await q.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await q.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await q.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ${role}`);
    await q.query(`REVOKE ALL ON schema_migrations FROM ${role}`);
    await q.query(`GRANT SELECT ON schema_migrations TO ${role}`);
  });
}
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
