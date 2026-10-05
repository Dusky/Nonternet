import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, runMigrations } from 'graphile-worker';
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

// The job queue (graphile-worker, docs/01) keeps its tables in its own schema and brings its own migrations. They run
// here, as the owner, so the runtime role never needs to create anything; grantRuntimeRole then lets it use them.
export async function migrateWorker(db: Db): Promise<void> {
  await runMigrations({ pgPool: db.pool, logger: quietLogger });
}
// Only problems are worth a line in core's log; the runner's routine chatter is not.
export const quietLogger = new Logger(() => (level, message) => { if (level === 'error' || level === 'warning') console.warn(`jobs: ${message}`); });

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
    // The job queue's schema: core adds, takes and finishes jobs there, and the runner checks its migrations are done.
    if ((await q.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker'`)).rowCount) {
      await q.query(`GRANT USAGE ON SCHEMA graphile_worker TO ${role}`);
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO ${role}`);
      await q.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA graphile_worker TO ${role}`);
      await q.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO ${role}`);
      // Its private tables have row-level security on with no policies (owner only); this role gets one policy each.
      const locked = await q.query<{ t: string }>(
        `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'graphile_worker' AND c.relkind = 'r' AND c.relrowsecurity`);
      for (const { t } of locked.rows) {
        await q.query(`DROP POLICY IF EXISTS core_runtime ON graphile_worker.${quoteIdent(t)}`);
        await q.query(`CREATE POLICY core_runtime ON graphile_worker.${quoteIdent(t)} FOR ALL TO ${role} USING (true) WITH CHECK (true)`);
      }
    }
    await q.query(`REVOKE ALL ON schema_migrations FROM ${role}`);
    await q.query(`GRANT SELECT ON schema_migrations TO ${role}`);
  });
}
const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
