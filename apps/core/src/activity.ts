import type { AppDeps } from './deps';

// Days people were active (docs/11 stats). Written at most once per person, per service, per day from each
// core process, so a busy session costs one small write a day. Failures are ignored: this is statistics.
export type ActivityService = 'web' | 'irc' | 'mud';
const seen = new Map<string, string>(); // "user:service" → the UTC day last written

export function noteActive(deps: AppDeps, userId: string, service: ActivityService): void {
  const day = new Date(deps.now()).toISOString().slice(0, 10);
  const key = `${userId}:${service}`;
  if (seen.get(key) === day) return;
  seen.set(key, day);
  if (seen.size > 100_000) seen.clear();
  deps.db.query(
    `INSERT INTO activity_days (user_id, day, services) VALUES ($1, $2, ARRAY[$3])
     ON CONFLICT (user_id, day) DO UPDATE SET services = CASE WHEN $3 = ANY(activity_days.services) THEN activity_days.services ELSE activity_days.services || $3 END`,
    [userId, day, service]).catch(() => seen.delete(key));
}

// Forgetting old days; run with the hourly metrics.
export async function pruneActivity(deps: AppDeps): Promise<void> {
  await deps.db.query(`DELETE FROM activity_days WHERE day < (now() - interval '400 days')::date`);
}
