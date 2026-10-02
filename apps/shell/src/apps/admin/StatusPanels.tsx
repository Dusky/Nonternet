import { useQuery } from '@tanstack/react-query';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, Loading, EmptyState } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

interface Status {
  at: string; db: { ok: boolean; ms: number }; redis: { configured: boolean; ok: boolean; ms: number | null };
  outbox: { backlog: number; oldest_age_s: number | null }; exports: { queued: number; running: number; failed_24h: number };
  disk: { homes: { free_bytes: number; total_bytes: number } | null; exports: { free_bytes: number; total_bytes: number } | null };
  counts: { users: { total: number; active: number; suspended: number; new_24h: number }; posts_24h: number; boards: number; rings: number; homepages: { count: number; bytes: number }; reports: { open: number; escalated: number } };
  backups: { lastBackup: { at: string; size_bytes: number | null } | null; backupOverdue: boolean; backupGrace: boolean; lastRestoreTest: { at: string; ok: boolean } | null; restoreTestOverdue: boolean; restoreTestGrace: boolean };
  security: { require_admin_2fa: boolean; admins_without_2fa: number };
  warnings: string[];
}
interface Series { metric: string; points: { at: string; value: number }[] }

const size = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(n / 1024))} KB`);
const age = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

function Tile({ title, value, detail, bad }: { title: string; value: string; detail?: string; bad?: boolean }) {
  return (
    <div className={`tile${bad ? ' tile-bad' : ''}`} role="group" aria-label={title}>
      <h3>{title}</h3>
      <p className="tile-value">{value}</p>
      {detail && <p className="hint">{detail}</p>}
    </div>
  );
}

// A small line chart: one number per hour. It is a picture, so it carries a sentence with the total.
function Spark({ metric }: { metric: 'posts' | 'signups' }) {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'metric', metric], queryFn: () => api.get<Series>(`/admin/metrics?metric=${metric}&hours=48`), refetchInterval: 60_000 });
  const pts = q.data?.points ?? [];
  const total = pts.reduce((n, p) => n + p.value, 0);
  const max = Math.max(1, ...pts.map((p) => p.value));
  const w = 240; const h = 48;
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / Math.max(1, pts.length - 1)) * w).toFixed(1)} ${(h - 3 - (p.value / max) * (h - 8)).toFixed(1)}`).join(' ');
  return (
    <figure className="spark">
      <figcaption>{t(`admin.status.chart.heading.${metric}` as StringKey)}</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={t(`admin.status.chart.${metric}` as StringKey, { total })}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  );
}

export function StatusPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'status'], queryFn: () => api.get<Status>('/admin/status'), refetchInterval: 15_000 });
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const s = q.data;
  if (!s) return <Loading />;
  const free = (d: { free_bytes: number } | null) => (d ? size(d.free_bytes) : '?');
  const c = s.counts;
  return (
    <>
      <h2>{t('admin.status.title')}</h2>
      {s.warnings.length === 0
        ? <Alert kind="success">{t('admin.status.allGood')}</Alert>
        : <div role="alert" className="alert alert-error"><strong>{t('admin.status.attention')}</strong><ul>{s.warnings.map((w) => <li key={w}>{t(`admin.status.warn.${w}` as StringKey)}</li>)}</ul></div>}
      {s.security.admins_without_2fa > 0 && <Alert kind="info">{t('admin.status.no2fa', { count: s.security.admins_without_2fa })}</Alert>}
      <div className="tiles">
        <Tile title={t('admin.status.tile.users')} value={String(c.users.total)} detail={t('admin.status.tile.usersDetail', { active: c.users.active, suspended: c.users.suspended, fresh: c.users.new_24h })} />
        <Tile title={t('admin.status.tile.posts')} value={String(c.posts_24h)} />
        <Tile title={t('admin.status.tile.content')} value={String(c.boards + c.rings)} detail={t('admin.status.tile.contentDetail', { boards: c.boards, rings: c.rings })} />
        <Tile title={t('admin.status.tile.homepages')} value={String(c.homepages.count)} detail={t('admin.status.tile.homepagesDetail', { size: size(c.homepages.bytes) })} />
        <Tile title={t('admin.status.tile.reports')} value={String(c.reports.open)} detail={t('admin.status.tile.reportsDetail', { count: c.reports.escalated })} bad={c.reports.escalated > 0} />
        <Tile title={t('admin.status.tile.database')} value={s.db.ok ? 'OK' : '!'} detail={t('admin.status.tile.databaseDetail', { ms: s.db.ms })} bad={s.warnings.includes('db_slow')} />
        <Tile title={t('admin.status.tile.redis')} value={s.redis.configured ? (s.redis.ok ? 'OK' : '!') : '–'} detail={s.redis.configured ? (s.redis.ok ? t('admin.status.tile.redisOk', { ms: s.redis.ms ?? 0 }) : t('admin.status.tile.redisDown')) : t('admin.status.tile.redisOff')} bad={s.redis.configured && !s.redis.ok} />
        <Tile title={t('admin.status.tile.events')} value={String(s.outbox.backlog)} detail={s.outbox.oldest_age_s === null ? t('admin.status.tile.eventsEmpty') : t('admin.status.tile.eventsDetail', { age: age(s.outbox.oldest_age_s) })} bad={s.warnings.includes('outbox_backlog')} />
        <Tile title={t('admin.status.tile.exports')} value={String(s.exports.queued + s.exports.running)} detail={t('admin.status.tile.exportsDetail', { queued: s.exports.queued, running: s.exports.running, failed: s.exports.failed_24h })} bad={s.exports.failed_24h > 0} />
        <Tile title={t('admin.status.tile.disk')} value={free(s.disk.homes)} detail={t('admin.status.tile.diskDetail', { homes: free(s.disk.homes), exports: free(s.disk.exports) })} bad={s.warnings.includes('disk_low')} />
        <Tile title={t('admin.status.tile.backup')} value={s.backups.lastBackup ? formatWhen(s.backups.lastBackup.at) ?? '' : t(s.backups.backupGrace ? 'admin.status.tile.backupSoon' : 'admin.status.tile.backupNever')} detail={!s.backups.lastBackup && s.backups.backupGrace ? t('admin.status.tile.backupSoonDetail') : undefined} bad={s.backups.backupOverdue} />
        <Tile title={t('admin.status.tile.restore')} value={s.backups.lastRestoreTest ? t(s.backups.lastRestoreTest.ok ? 'admin.status.tile.restoreOk' : 'admin.status.tile.restoreFailed', { when: formatWhen(s.backups.lastRestoreTest.at) ?? '' }) : t(s.backups.restoreTestGrace ? 'admin.status.tile.restoreSoon' : 'admin.status.tile.restoreNever')} detail={!s.backups.lastRestoreTest && s.backups.restoreTestGrace ? t('admin.status.tile.restoreSoonDetail') : undefined} bad={s.backups.restoreTestOverdue} />
      </div>
      <div className="sparks"><Spark metric="posts" /><Spark metric="signups" /></div>
      <p className="hint">{t('admin.status.refreshed', { when: formatWhen(s.at) ?? '' })}</p>
    </>
  );
}

// ---------------------------------------------------------------- backups

interface Run { id: string; kind: 'backup' | 'restore_test'; status: 'running' | 'ok' | 'failed'; started_at: string; finished_at: string | null; size_bytes: number | null; location: string | null; detail: { checks?: { name: string; expected: unknown; actual: unknown; ok: boolean }[]; counts?: Record<string, number> } | null; error: string | null }

export function BackupsPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'backups'], queryFn: () => api.get<{ runs: Run[]; summary: Status['backups'] }>('/admin/backups'), refetchInterval: 60_000 });
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading />;
  const { runs, summary } = q.data;
  return (
    <>
      <h2>{t('admin.backups.title')}</h2>
      <p>{t('admin.backups.intro')}</p>
      <p className="hint">{t('admin.backups.commands')}</p>
      {(summary.backupOverdue || summary.restoreTestOverdue) && (
        <div role="alert" className="alert alert-error"><ul>
          {summary.backupOverdue && <li>{t('admin.status.warn.backup_overdue')}</li>}
          {summary.restoreTestOverdue && <li>{t('admin.status.warn.restore_test_overdue')}</li>}
        </ul></div>
      )}
      {runs.length === 0 && <EmptyState>{t('admin.backups.none')}</EmptyState>}
      {runs.length > 0 && (
        <table className="table">
          <thead><tr>
            <th scope="col">{t('admin.backups.col.kind')}</th><th scope="col">{t('admin.backups.col.status')}</th><th scope="col">{t('admin.backups.col.when')}</th>
            <th scope="col">{t('admin.backups.col.size')}</th><th scope="col">{t('admin.backups.col.detail')}</th>
          </tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <th scope="row" data-label={t('admin.backups.col.kind')}>{t(`admin.backups.kind.${r.kind}` as StringKey)}</th>
                <td data-label={t('admin.backups.col.status')}><span className={`badge ${r.status === 'ok' ? 'badge-open' : r.status === 'failed' ? 'badge-warn' : ''}`}>{t(`admin.backups.status.${r.status}` as StringKey)}</span></td>
                <td data-label={t('admin.backups.col.when')}>{formatWhen(r.started_at)}</td>
                <td data-label={t('admin.backups.col.size')}>{r.size_bytes === null ? '–' : size(r.size_bytes)}</td>
                <td data-label={t('admin.backups.col.detail')}>
                  {r.error && <p>{r.error}</p>}
                  {r.detail?.checks && (
                    <details>
                      <summary>{t('admin.backups.checks')}</summary>
                      <ul>{r.detail.checks.map((c) => <li key={c.name}>{c.name}: {t(c.ok ? 'admin.backups.check.ok' : 'admin.backups.check.failed')}{c.ok ? '' : ` (${String(c.expected)} → ${String(c.actual)})`}</li>)}</ul>
                    </details>
                  )}
                  {r.location && !r.detail?.checks && <code>{r.location}</code>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
