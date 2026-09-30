import { z } from 'zod';
import { audit } from './audit';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { Ctx, SessionUser } from './accounts';

// The settings an admin can change without a deploy (docs/11). Everything else, including the site
// name and domains, stays in the config file. Each has a schema, where it lives in the config, and
// whether a change needs a preview and a second confirmation first ("risky").
type Cfg = AppDeps['config'];
export interface SettingDef {
  key: string;
  schema: z.ZodType<unknown>;
  get(c: Cfg): unknown;
  set(c: Cfg, v: unknown): void;
  risky: boolean;
  // Says who a change would touch, shown in the preview.
  impact?(deps: AppDeps, next: unknown): Promise<{ affected: number; note: string } | null>;
  check?(c: Cfg, next: unknown): string | null;
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const MB = 1048576;

export const SETTINGS: SettingDef[] = [
  { key: 'signup.mode', schema: z.enum(['open', 'invite']), risky: true, get: (c) => c.signup.mode, set: (c, v) => { c.signup.mode = v as 'open' | 'invite'; } },
  { key: 'signup.minimum_age', schema: int(0, 120), risky: true, get: (c) => c.signup.minimum_age, set: (c, v) => { c.signup.minimum_age = v as number; } },
  { key: 'limits.trusted_board_quota', schema: int(0, 100), risky: false, get: (c) => c.limits.trusted_board_quota, set: (c, v) => { c.limits.trusted_board_quota = v as number; },
    impact: async (deps, next) => ({ affected: Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM (SELECT owner_id FROM boards WHERE archived_at IS NULL AND ring_id IS NULL GROUP BY owner_id HAVING count(*) > $1) x`, [next])).rows[0]!.n), note: 'people who already own more boards than that keep them but cannot make new ones' }) },
  { key: 'limits.trusted_ring_quota', schema: int(0, 100), risky: false, get: (c) => c.limits.trusted_ring_quota, set: (c, v) => { c.limits.trusted_ring_quota = v as number; } },
  { key: 'limits.homepage_quota_mb.user', schema: z.number().min(1).max(10000), risky: true, get: (c) => c.limits.homepage_quota_mb.user, set: (c, v) => { c.limits.homepage_quota_mb.user = v as number; },
    check: (c, next) => ((next as number) > c.limits.homepage_quota_mb.trusted ? 'The space for users cannot be more than the space for trusted users.' : null),
    impact: async (deps, next) => ({ affected: Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM homepages h JOIN users u ON u.id = h.user_id WHERE u.role = 'user' AND h.size_bytes > $1`, [Math.floor((next as number) * MB)])).rows[0]!.n), note: 'homepages already bigger than that keep their files but cannot add more' }) },
  { key: 'limits.homepage_quota_mb.trusted', schema: z.number().min(1).max(10000), risky: true, get: (c) => c.limits.homepage_quota_mb.trusted, set: (c, v) => { c.limits.homepage_quota_mb.trusted = v as number; },
    check: (c, next) => ((next as number) < c.limits.homepage_quota_mb.user ? 'The space for trusted users cannot be less than the space for users.' : null),
    impact: async (deps, next) => ({ affected: Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM homepages h JOIN users u ON u.id = h.user_id WHERE u.role IN ('trusted', 'admin') AND h.size_bytes > $1`, [Math.floor((next as number) * MB)])).rows[0]!.n), note: 'homepages already bigger than that keep their files but cannot add more' }) },
  { key: 'limits.trusted_channel_quota', schema: int(0, 100), risky: false, get: (c) => c.limits.trusted_channel_quota, set: (c, v) => { c.limits.trusted_channel_quota = v as number; } },
  { key: 'limits.file_max_mb', schema: z.number().min(1).max(2000), risky: false, get: (c) => c.limits.file_max_mb, set: (c, v) => { c.limits.file_max_mb = v as number; } },
  { key: 'limits.file_quota_mb', schema: z.number().min(1).max(100000), risky: true, get: (c) => c.limits.file_quota_mb, set: (c, v) => { c.limits.file_quota_mb = v as number; },
    impact: async (deps, next) => ({ affected: Number((await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM (SELECT uploader_id FROM files WHERE deleted_at IS NULL AND uploader_id IS NOT NULL GROUP BY uploader_id HAVING sum(size_bytes) > $1) x`, [Math.floor((next as number) * MB)])).rows[0]!.n), note: 'people already over that keep their files but cannot upload more' }) },
  { key: 'homes.max_domains', schema: int(0, 20), risky: false, get: (c) => c.homes.max_domains, set: (c, v) => { c.homes.max_domains = v as number; } },
  { key: 'bbs.motd', schema: z.string().max(2000), risky: false, get: (c) => c.bbs.motd, set: (c, v) => { c.bbs.motd = v as string; } },
  { key: 'moderation.public_modlog', schema: z.boolean(), risky: false, get: (c) => c.moderation.public_modlog, set: (c, v) => { c.moderation.public_modlog = v as boolean; } },
];
export const settingDef = (key: string): SettingDef | undefined => SETTINGS.find((s) => s.key === key);

// The value each setting has in the config file, remembered before any change is applied.
const defaults = new WeakMap<Cfg, Map<string, unknown>>();
function fileDefaults(c: Cfg): Map<string, unknown> {
  let m = defaults.get(c);
  if (!m) { m = new Map(SETTINGS.map((s) => [s.key, structuredClone(s.get(c))])); defaults.set(c, m); }
  return m;
}

// At start-up: put the saved values over the config file's.
export async function loadSettings(deps: AppDeps): Promise<void> {
  fileDefaults(deps.config);
  const r = await deps.db.query<{ key: string; value: unknown }>(`SELECT key, value FROM settings_current`);
  for (const row of r.rows) {
    const def = settingDef(row.key);
    if (row.value === null) continue;
    const ok = def?.schema.safeParse(row.value);
    if (def && ok?.success) def.set(deps.config, ok.data);
  }
}

export interface SettingView {
  key: string; value: unknown; default: unknown; overridden: boolean; version: number; risky: boolean; updated_at: string | null; updated_by: string | null;
}

export async function listSettings(deps: AppDeps): Promise<{ settings: SettingView[]; readonly: { name: string; short_name: string; domain: string; homes_domain: string } }> {
  const d = fileDefaults(deps.config);
  const cur = await deps.db.query<{ key: string; value: unknown; version: number; updated_at: Date; handle: string | null }>(
    `SELECT s.key, s.value, s.version, s.updated_at, u.handle FROM settings_current s LEFT JOIN users u ON u.id = s.updated_by`);
  const by = new Map(cur.rows.map((r) => [r.key, r]));
  return {
    settings: SETTINGS.map((s) => {
      const row = by.get(s.key);
      return { key: s.key, value: s.get(deps.config), default: d.get(s.key), overridden: Boolean(row) && row!.value !== null, version: row?.version ?? 0, risky: s.risky,
        updated_at: row ? row.updated_at.toISOString() : null, updated_by: row?.handle ?? null };
    }),
    readonly: { ...deps.config.site },
  };
}

export type ChangeResult = { changed: true; version: number } | { pending: true; current: unknown; next: unknown; impact: { affected: number; note: string } | null };

// One change. A risky setting does nothing the first time: it answers with a preview of what would
// happen, and only a second call with confirm set makes the change. `next` of null means "use the
// config file's value again".
export async function changeSetting(deps: AppDeps, admin: SessionUser, key: string, next: unknown, reason: string, confirm: boolean, ctx: Ctx): Promise<ChangeResult> {
  const def = settingDef(key);
  if (!def) throw new ApiError(404, 'not_found', 'No such setting.');
  const d = fileDefaults(deps.config);
  const value = next === null ? structuredClone(d.get(key)) : def.schema.safeParse(next);
  if (next !== null && !(value as z.SafeParseReturnType<unknown, unknown>).success) {
    throw new ApiError(400, 'invalid_value', ((value as z.SafeParseError<unknown>).error.issues[0]?.message) ?? 'That value is not allowed.');
  }
  const parsed = next === null ? value : (value as z.SafeParseSuccess<unknown>).data;
  const problem = def.check?.(deps.config, parsed);
  if (problem) throw new ApiError(400, 'invalid_value', problem);
  const current = def.get(deps.config);
  if (JSON.stringify(current) === JSON.stringify(parsed)) throw new ApiError(409, 'no_change', 'That is already the value.');
  if (def.risky && !confirm) return { pending: true, current, next: parsed, impact: (await def.impact?.(deps, parsed)) ?? null };
  return { changed: true, version: await write(deps, admin, def, next === null ? null : parsed, parsed, reason, null, ctx) };
}

export async function rollbackSetting(deps: AppDeps, admin: SessionUser, key: string, version: number, reason: string, ctx: Ctx): Promise<{ changed: true; version: number }> {
  const def = settingDef(key);
  if (!def) throw new ApiError(404, 'not_found', 'No such setting.');
  const h = await deps.db.query<{ value: unknown }>(`SELECT value FROM settings_history WHERE key = $1 AND version = $2`, [key, version]);
  if (!h.rows[0]) throw new ApiError(404, 'not_found', 'There is no such version.');
  const stored = h.rows[0].value;
  const eff = stored === null ? structuredClone(fileDefaults(deps.config).get(key)) : stored;
  const problem = def.check?.(deps.config, eff);
  if (problem) throw new ApiError(400, 'invalid_value', problem);
  if (JSON.stringify(def.get(deps.config)) === JSON.stringify(eff)) throw new ApiError(409, 'no_change', 'That is already the value.');
  return { changed: true, version: await write(deps, admin, def, stored, eff, reason, version, ctx) };
}

// Stores the change, then puts it into effect once it is safely saved.
async function write(deps: AppDeps, admin: SessionUser, def: SettingDef, stored: unknown, effective: unknown, reason: string, rolledBackTo: number | null, ctx: Ctx): Promise<number> {
  const before = def.get(deps.config);
  const version = await deps.db.tx(async (q) => {
    const cur = await q.query<{ version: number }>(`SELECT version FROM settings_current WHERE key = $1 FOR UPDATE`, [def.key]);
    const v = (cur.rows[0]?.version ?? 0) + 1;
    // A stored null means "use the config file's value"; the row stays so version numbers keep counting.
    await q.query(`INSERT INTO settings_current (key, value, version, updated_by) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = EXCLUDED.version, updated_at = now(), updated_by = EXCLUDED.updated_by`, [def.key, JSON.stringify(stored ?? null), v, admin.userId]);
    await q.query(`INSERT INTO settings_history (key, version, value, previous, reason, changed_by, rolled_back_to) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [def.key, v, stored === null ? null : JSON.stringify(stored), JSON.stringify(before), reason, admin.userId, rolledBackTo]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'settings.changed', targetType: 'setting', targetId: def.key, before: { value: before }, after: { value: effective, reason, ...(rolledBackTo ? { rolled_back_to: rolledBackTo } : {}) }, origin: 'web', ipHash: ctx.ipHash });
    return v;
  });
  def.set(deps.config, effective);
  return version;
}

export async function settingHistory(deps: AppDeps, key: string): Promise<{ history: { version: number; value: unknown; previous: unknown; reason: string; by: string | null; at: string; rolled_back_to: number | null }[] }> {
  if (!settingDef(key)) throw new ApiError(404, 'not_found', 'No such setting.');
  const r = await deps.db.query<{ version: number; value: unknown; previous: unknown; reason: string; handle: string | null; changed_at: Date; rolled_back_to: number | null }>(
    `SELECT h.version, h.value, h.previous, h.reason, u.handle, h.changed_at, h.rolled_back_to FROM settings_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.key = $1 ORDER BY h.version DESC LIMIT 100`, [key]);
  return { history: r.rows.map((x) => ({ version: x.version, value: x.value, previous: x.previous, reason: x.reason, by: x.handle, at: x.changed_at.toISOString(), rolled_back_to: x.rolled_back_to })) };
}
