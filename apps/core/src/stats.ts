import type { AdminStats } from '@app/shared';
import type { AppDeps } from './deps';

// Historical stats for the console (docs/11 §9): active people by day, retention by signup week, when
// people post (weekday × hour), and content counts. All worked out from the tables when asked; nothing
// here writes. Days and hours are UTC.

export async function stats(deps: AppDeps, opts: { days?: number; weeks?: number } = {}): Promise<AdminStats> {
  const days = Math.min(Math.max(opts.days ?? 90, 7), 365);
  const weeks = Math.min(Math.max(opts.weeks ?? 12, 2), 52);
  const today = new Date(deps.now()).toISOString().slice(0, 10);

  // Daily, 7-day and 30-day distinct active people for each day in the range.
  const active = await deps.db.query<{ day: string; dau: number; wau: number; mau: number; signups: number; posts: number }>(
    `WITH d AS (SELECT generate_series($1::date - ($2::int - 1), $1::date, interval '1 day')::date AS day)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
       (SELECT count(*)::int FROM activity_days a WHERE a.day = d.day) AS dau,
       (SELECT count(DISTINCT a.user_id)::int FROM activity_days a WHERE a.day > d.day - 7 AND a.day <= d.day) AS wau,
       (SELECT count(DISTINCT a.user_id)::int FROM activity_days a WHERE a.day > d.day - 30 AND a.day <= d.day) AS mau,
       (SELECT count(*)::int FROM users u WHERE u.created_at >= d.day AND u.created_at < d.day + 1) AS signups,
       (SELECT count(*)::int FROM posts p WHERE p.posted_at >= d.day AND p.posted_at < d.day + 1) AS posts
     FROM d ORDER BY d.day`, [today, days]);

  // Retention: people who signed up in each week, and how many were active in each week after.
  const cohortRows = await deps.db.query<{ week: string; size: number; offset: number; n: number }>(
    `WITH c AS (
       SELECT u.id, date_trunc('week', u.created_at)::date AS week FROM users u
       WHERE u.created_at >= date_trunc('week', $1::date) - ($2::int - 1) * interval '1 week'
     ), sizes AS (SELECT week, count(*)::int AS size FROM c GROUP BY week),
     act AS (
       SELECT c.week, ((date_trunc('week', a.day)::date - c.week) / 7)::int AS offset, count(DISTINCT a.user_id)::int AS n
       FROM c JOIN activity_days a ON a.user_id = c.id GROUP BY 1, 2
     )
     SELECT to_char(s.week, 'YYYY-MM-DD') AS week, s.size, COALESCE(act.offset, -1) AS offset, COALESCE(act.n, 0) AS n
     FROM sizes s LEFT JOIN act ON act.week = s.week ORDER BY s.week, act.offset`, [today, weeks]);
  const cohorts = new Map<string, { week: string; size: number; active: number[] }>();
  for (const r of cohortRows.rows) {
    let c = cohorts.get(r.week);
    if (!c) {
      const age = Math.floor((Date.parse(today) - Date.parse(r.week)) / (7 * 86_400_000));
      c = { week: r.week, size: r.size, active: Array.from({ length: age + 1 }, () => 0) };
      cohorts.set(r.week, c);
    }
    if (r.offset >= 0 && r.offset < c.active.length) c.active[r.offset] = r.n;
  }

  // When people post: 7 weekdays (Monday first) × 24 hours.
  const heat = await deps.db.query<{ dow: number; hour: number; n: number }>(
    `SELECT (extract(isodow FROM posted_at AT TIME ZONE 'UTC')::int - 1) AS dow, extract(hour FROM posted_at AT TIME ZONE 'UTC')::int AS hour, count(*)::int AS n
     FROM posts WHERE posted_at >= $1::date - $2::int GROUP BY 1, 2`, [today, days]);
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const h of heat.rows) heatmap[h.dow]![h.hour] = h.n;

  const totals = (await deps.db.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM users WHERE status = 'active') AS users,
            (SELECT count(*)::int FROM posts WHERE deleted_at IS NULL) AS posts,
            (SELECT count(*)::int FROM homepages WHERE has_index) AS homepages,
            (SELECT count(*)::int FROM rings WHERE archived_at IS NULL) AS rings,
            (SELECT count(*)::int FROM files WHERE deleted_at IS NULL) AS files,
            (SELECT count(*)::int FROM mail_messages WHERE kind = 'message') AS mail_messages`)).rows[0]!;

  return { days: active.rows, cohorts: [...cohorts.values()], heatmap, totals: totals as AdminStats['totals'], range: { days, weeks, until: today } };
}

// The same numbers as CSV, for spreadsheets.
export function statsCsv(s: AdminStats, kind: 'days' | 'cohorts' | 'heatmap'): string {
  const row = (xs: (string | number)[]) => xs.map((x) => (typeof x === 'string' && /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : String(x))).join(',');
  if (kind === 'days') return [row(['day', 'dau', 'wau', 'mau', 'signups', 'posts']), ...s.days.map((d) => row([d.day, d.dau, d.wau, d.mau, d.signups, d.posts]))].join('\n') + '\n';
  if (kind === 'cohorts') {
    const width = Math.max(0, ...s.cohorts.map((c) => c.active.length));
    return [row(['signup_week', 'size', ...Array.from({ length: width }, (_, i) => `week_${i}`)]), ...s.cohorts.map((c) => row([c.week, c.size, ...c.active]))].join('\n') + '\n';
  }
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return [row(['weekday', ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)]), ...s.heatmap.map((r, i) => row([DAYS[i]!, ...r]))].join('\n') + '\n';
}
