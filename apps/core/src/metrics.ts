import { promises as fs } from 'node:fs';
import type { AppDeps } from './deps';
import { pruneActivity } from './activity';
import { summary as backupSummary } from './backups';

// Hourly numbers for the status board (docs/11). Counters are worked out from the real tables for each
// hour, so collecting the same hour twice gives the same answer. Gauges are a reading taken now.
const COUNTERS: Record<string, string> = {
  'signups': `SELECT count(*) FROM users WHERE created_at >= $1 AND created_at < $2`,
  'posts': `SELECT count(*) FROM posts WHERE posted_at >= $1 AND posted_at < $2`,
  'reports': `SELECT count(*) FROM reports WHERE created_at >= $1 AND created_at < $2`,
  'homepage_updates': `SELECT count(*) FROM homepages WHERE last_updated_at >= $1 AND last_updated_at < $2`,
  'exports': `SELECT count(*) FROM exports WHERE requested_at >= $1 AND requested_at < $2`,
};
const GAUGES: Record<string, string> = {
  'users': `SELECT count(*) FROM users WHERE status = 'active'`,
  'homepage_bytes': `SELECT COALESCE(sum(size_bytes), 0) FROM homepages`,
  'outbox_backlog': `SELECT count(*) FROM events_outbox WHERE published_at IS NULL`,
  'open_reports': `SELECT count(*) FROM reports WHERE status = 'open'`,
};
export const METRICS = [...Object.keys(COUNTERS), ...Object.keys(GAUGES)];
const HOUR = 3_600_000;
const hourStart = (ms: number) => new Date(Math.floor(ms / HOUR) * HOUR);

export async function collectMetrics(deps: AppDeps, hours = 48): Promise<void> {
  const now = deps.now();
  const current = hourStart(now);
  for (let i = 0; i < hours; i++) {
    const start = new Date(current.getTime() - i * HOUR);
    const end = new Date(start.getTime() + HOUR);
    for (const [metric, sql] of Object.entries(COUNTERS)) {
      const v = Number((await deps.db.query<{ count: string }>(sql, [start, end])).rows[0]!.count);
      await deps.db.query(`INSERT INTO metrics_rollup (metric, bucket, value) VALUES ($1, $2, $3) ON CONFLICT (metric, bucket) DO UPDATE SET value = EXCLUDED.value`, [metric, start, v]);
    }
  }
  for (const [metric, sql] of Object.entries(GAUGES)) {
    const v = Number(Object.values((await deps.db.query<Record<string, string>>(sql)).rows[0]!)[0]);
    await deps.db.query(`INSERT INTO metrics_rollup (metric, bucket, value) VALUES ($1, $2, $3) ON CONFLICT (metric, bucket) DO UPDATE SET value = EXCLUDED.value`, [metric, current, v]);
  }
  await deps.db.query(`DELETE FROM metrics_rollup WHERE bucket < $1`, [new Date(now - 90 * 24 * HOUR)]);
  await pruneActivity(deps);
}

// One number per hour for the last N hours, oldest first. Hours with nothing recorded count as 0 for counters.
export async function series(deps: AppDeps, metric: string, hours: number): Promise<{ metric: string; points: { at: string; value: number }[] }> {
  const current = hourStart(deps.now()).getTime();
  const r = await deps.db.query<{ bucket: Date; value: number }>(`SELECT bucket, value FROM metrics_rollup WHERE metric = $1 AND bucket > $2`, [metric, new Date(current - hours * HOUR)]);
  const by = new Map(r.rows.map((x) => [x.bucket.getTime(), x.value]));
  return { metric, points: Array.from({ length: hours }, (_, i) => { const t = current - (hours - 1 - i) * HOUR; return { at: new Date(t).toISOString(), value: by.get(t) ?? 0 }; }) };
}

export function startMetricsCollector(deps: AppDeps, log: (m: string) => void): { stop(): void } {
  const run = () => collectMetrics(deps, 3).catch((e) => log(`metrics: ${e}`));
  collectMetrics(deps, 48).catch((e) => log(`metrics: ${e}`));   // fill in what a restart missed
  const timer = setInterval(run, 5 * 60_000);
  return { stop: () => clearInterval(timer) };
}

// ---------------------------------------------------------------- the status board

let redisClient: import('ioredis').default | null = null;
async function redisPing(): Promise<{ configured: boolean; ok: boolean; ms: number | null }> {
  const url = process.env.REDIS_URL;
  if (!url) return { configured: false, ok: false, ms: null };
  const { default: Redis } = await import('ioredis');
  redisClient ??= new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 1500 });
  const t = Date.now();
  try { await redisClient.ping(); return { configured: true, ok: true, ms: Date.now() - t }; } catch { return { configured: true, ok: false, ms: null }; }
}

async function disk(dir: string): Promise<{ free_bytes: number; total_bytes: number } | null> {
  try { const s = await fs.statfs(dir); return { free_bytes: s.bavail * s.bsize, total_bytes: s.blocks * s.bsize }; } catch { return null; }
}

const startedAt = Date.now();

export async function getStatus(deps: AppDeps) {
  const now = deps.now();
  const t0 = Date.now();
  await deps.db.query('SELECT 1');
  const dbMs = Date.now() - t0;
  const one = async <T extends Record<string, string | number | null>>(sql: string, params: unknown[] = []) => (await deps.db.query<T>(sql, params)).rows[0]!;
  const [users, posts, content, homepages, reports, outbox, exportsQ, backups, redis, homesDisk, exportsDisk] = await Promise.all([
    one<{ total: string; active: string; suspended: string; fresh: string }>(`SELECT count(*) FILTER (WHERE status <> 'deleted') AS total, count(*) FILTER (WHERE status = 'active') AS active, count(*) FILTER (WHERE status = 'suspended') AS suspended, count(*) FILTER (WHERE created_at > $1) AS fresh FROM users`, [new Date(now - 86_400_000)]),
    one<{ n: string }>(`SELECT count(*) AS n FROM posts WHERE posted_at > $1 AND deleted_at IS NULL`, [new Date(now - 86_400_000)]),
    one<{ boards: string; rings: string }>(`SELECT (SELECT count(*) FROM boards WHERE archived_at IS NULL) AS boards, (SELECT count(*) FROM rings WHERE archived_at IS NULL) AS rings`),
    one<{ n: string; bytes: string }>(`SELECT count(*) AS n, COALESCE(sum(size_bytes), 0) AS bytes FROM homepages WHERE has_index`),
    one<{ open: string; escalated: string }>(`SELECT count(*) FILTER (WHERE status = 'open') AS open, count(*) FILTER (WHERE status = 'open' AND created_at < $1) AS escalated FROM reports`, [new Date(now - 86_400_000)]),
    one<{ backlog: string; oldest: number | null }>(`SELECT count(*) AS backlog, EXTRACT(EPOCH FROM (now() - min(created_at)))::float AS oldest FROM events_outbox WHERE published_at IS NULL`),
    one<{ queued: string; running: string; failed: string }>(`SELECT count(*) FILTER (WHERE status = 'queued') AS queued, count(*) FILTER (WHERE status = 'running') AS running, count(*) FILTER (WHERE status = 'failed' AND requested_at > $1) AS failed FROM exports`, [new Date(now - 86_400_000)]),
    backupSummary(deps),
    redisPing(),
    disk(deps.homes.root),
    disk(deps.exportsDir),
  ]);
  const status = {
    at: new Date(now).toISOString(), uptime_s: Math.round((Date.now() - startedAt) / 1000),
    db: { ok: true, ms: dbMs }, redis,
    outbox: { backlog: Number(outbox.backlog), oldest_age_s: outbox.oldest === null ? null : Math.round(Number(outbox.oldest)) },
    exports: { queued: Number(exportsQ.queued), running: Number(exportsQ.running), failed_24h: Number(exportsQ.failed) },
    disk: { homes: homesDisk, exports: exportsDisk },
    counts: {
      users: { total: Number(users.total), active: Number(users.active), suspended: Number(users.suspended), new_24h: Number(users.fresh) },
      posts_24h: Number(posts.n), boards: Number(content.boards), rings: Number(content.rings),
      homepages: { count: Number(homepages.n), bytes: Number(homepages.bytes) },
      reports: { open: Number(reports.open), escalated: Number(reports.escalated) },
    },
    backups,
    warnings: [] as string[],
  };
  // Plain codes; the console words them.
  if (dbMs > 500) status.warnings.push('db_slow');
  if (redis.configured && !redis.ok) status.warnings.push('redis_down');
  if (status.outbox.backlog > 1000 || (status.outbox.oldest_age_s ?? 0) > 600) status.warnings.push('outbox_backlog');
  if (status.exports.failed_24h > 0) status.warnings.push('exports_failing');
  if (status.counts.reports.escalated > 0) status.warnings.push('reports_waiting');
  if (backups.backupOverdue) status.warnings.push('backup_overdue');
  if (backups.restoreTestOverdue) status.warnings.push('restore_test_overdue');
  for (const d of [homesDisk, exportsDisk]) if (d && d.free_bytes / d.total_bytes < 0.1) { status.warnings.push('disk_low'); break; }
  return status;
}
