import type { AppDeps } from './deps';

// What the console shows about backups (docs/15): when the last good one was, and when a restore was last
// proved to work. The backups themselves are made and checked by the operator commands in backup.ts.
export const BACKUP_MAX_AGE_HOURS = 26;      // nightly, with a little room
export const RESTORE_TEST_MAX_AGE_DAYS = 35; // monthly, with a little room

export interface BackupRunView { id: string; kind: 'backup' | 'restore_test'; status: 'running' | 'ok' | 'failed'; started_at: string; finished_at: string | null; size_bytes: number | null; location: string | null; detail: unknown; error: string | null }
export interface BackupSummary {
  lastBackup: { at: string; size_bytes: number | null } | null; backupOverdue: boolean;
  lastRestoreTest: { at: string; ok: boolean } | null; restoreTestOverdue: boolean;
}

export async function listRuns(deps: AppDeps, limit = 50): Promise<BackupRunView[]> {
  const r = await deps.db.query<{ id: string; kind: 'backup' | 'restore_test'; status: 'running' | 'ok' | 'failed'; started_at: Date; finished_at: Date | null; size_bytes: string | null; location: string | null; detail: unknown; error: string | null }>(
    `SELECT id, kind, status, started_at, finished_at, size_bytes, location, detail, error FROM backup_runs ORDER BY started_at DESC LIMIT $1`, [limit]);
  return r.rows.map((x) => ({ id: x.id, kind: x.kind, status: x.status, started_at: x.started_at.toISOString(), finished_at: x.finished_at ? x.finished_at.toISOString() : null, size_bytes: x.size_bytes === null ? null : Number(x.size_bytes), location: x.location, detail: x.detail, error: x.error }));
}

export async function summary(deps: AppDeps): Promise<BackupSummary> {
  const now = deps.now();
  const last = async (kind: string, okOnly: boolean) => (await deps.db.query<{ started_at: Date; size_bytes: string | null; status: string }>(
    `SELECT started_at, size_bytes, status FROM backup_runs WHERE kind = $1 AND status <> 'running' ${okOnly ? `AND status = 'ok'` : ''} ORDER BY started_at DESC LIMIT 1`, [kind])).rows[0];
  const [b, t] = await Promise.all([last('backup', true), last('restore_test', false)]);
  const okTest = t ? (await deps.db.query<{ started_at: Date }>(`SELECT started_at FROM backup_runs WHERE kind = 'restore_test' AND status = 'ok' ORDER BY started_at DESC LIMIT 1`)).rows[0] : undefined;
  return {
    lastBackup: b ? { at: b.started_at.toISOString(), size_bytes: b.size_bytes === null ? null : Number(b.size_bytes) } : null,
    backupOverdue: !b || now - b.started_at.getTime() > BACKUP_MAX_AGE_HOURS * 3_600_000,
    lastRestoreTest: t ? { at: t.started_at.toISOString(), ok: t.status === 'ok' } : null,
    // "Overdue" means no restore test has passed recently, however many have failed since.
    restoreTestOverdue: !okTest || now - okTest.started_at.getTime() > RESTORE_TEST_MAX_AGE_DAYS * 86_400_000,
  };
}
