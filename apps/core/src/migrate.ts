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
