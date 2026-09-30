import type { HomeFileEntry, HomepageSummary } from '@app/shared';
import { audit } from '../audit';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import type { Ctx, SessionUser } from '../accounts';
import { isEditable } from './files';
import { assetById } from './assets';
import { templateById } from './templates';

const MB = 1048576;

export function assertCanHost(v: SessionUser): void {
  if (v.role === 'guest') throw new ApiError(403, 'email_not_verified', 'Confirm your email address to make a homepage.');
}
export const quotaBytes = (deps: AppDeps, role: SessionUser['role']): number =>
  Math.floor((role === 'trusted' || role === 'admin' ? deps.config.limits.homepage_quota_mb.trusted : deps.config.limits.homepage_quota_mb.user) * MB);
export const fileMaxBytes = (deps: AppDeps): number => Math.floor(deps.config.limits.homepage_file_max_mb * MB);

async function ensureRow(deps: AppDeps, userId: string): Promise<void> {
  await deps.db.query(`INSERT INTO homepages (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
}

// Bring the summary in line with what is on disk, after any change.
export async function refresh(deps: AppDeps, userId: string, touched = true): Promise<void> {
  await ensureRow(deps, userId);
  const u = await deps.homes.usage(userId);
  await deps.db.query(
    `UPDATE homepages SET size_bytes = $2, file_count = $3, has_index = $4, last_updated_at = CASE WHEN $5 THEN now() ELSE last_updated_at END WHERE user_id = $1`,
    [userId, u.bytes, u.files, u.hasIndex, touched]);
}

export async function getMine(deps: AppDeps, v: SessionUser): Promise<{ homepage: HomepageSummary; files: HomeFileEntry[] }> {
  assertCanHost(v);
  await ensureRow(deps, v.userId);
  await refresh(deps, v.userId, false);
  const r = await deps.db.query<{ title: string; description: string; size_bytes: string; file_count: number; has_index: boolean; last_updated_at: Date | null; hidden_at: Date | null }>(
    `SELECT title, description, size_bytes, file_count, has_index, last_updated_at, hidden_at FROM homepages WHERE user_id = $1`, [v.userId]);
  const h = r.rows[0]!;
  const tree = await deps.homes.tree(v.userId);
  return {
    homepage: {
      title: h.title, description: h.description, url: deps.homesUrl(v.handle), has_index: h.has_index,
      size_bytes: Number(h.size_bytes), quota_bytes: quotaBytes(deps, v.role), file_max_bytes: fileMaxBytes(deps), file_count: h.file_count,
      last_updated_at: h.last_updated_at ? h.last_updated_at.toISOString() : null, hidden: h.hidden_at !== null,
    },
    files: tree.map((e) => ({ ...e, editable: e.type === 'file' && isEditable(e.path) })),
  };
}

export async function updateSettings(deps: AppDeps, v: SessionUser, patch: { title?: string; description?: string }): Promise<void> {
  assertCanHost(v);
  await ensureRow(deps, v.userId);
  await deps.db.query(`UPDATE homepages SET title = COALESCE($2, title), description = COALESCE($3, description) WHERE user_id = $1`, [v.userId, patch.title ?? null, patch.description ?? null]);
}

export async function putFile(deps: AppDeps, v: SessionUser, path: string, data: Buffer): Promise<void> {
  assertCanHost(v);
  await deps.homes.write(v.userId, path, data, { maxFile: fileMaxBytes(deps), quota: quotaBytes(deps, v.role) });
  await refresh(deps, v.userId);
}

export async function makeFolder(deps: AppDeps, v: SessionUser, path: string): Promise<void> {
  assertCanHost(v);
  await deps.homes.mkdir(v.userId, path);
  await refresh(deps, v.userId);
}

export async function removePath(deps: AppDeps, v: SessionUser, path: string): Promise<void> {
  assertCanHost(v);
  await deps.homes.remove(v.userId, path);
  await refresh(deps, v.userId);
}

export async function movePath(deps: AppDeps, v: SessionUser, from: string, to: string): Promise<void> {
  assertCanHost(v);
  await deps.homes.move(v.userId, from, to);
  await refresh(deps, v.userId);
}

// A starter page. It will not overwrite a homepage that already has a front page unless told to.
export async function applyTemplate(deps: AppDeps, v: SessionUser, id: string, replace: boolean): Promise<void> {
  assertCanHost(v);
  const t = templateById(id);
  if (!t) throw new ApiError(404, 'not_found', 'No such template.');
  const existing = await deps.homes.usage(v.userId);
  if (existing.hasIndex && !replace) throw new ApiError(409, 'not_empty', 'You already have a front page. Choose to replace it if you want to start over.');
  await ensureRow(deps, v.userId);
  const title = (await deps.db.query<{ title: string }>(`SELECT title FROM homepages WHERE user_id = $1`, [v.userId])).rows[0]!.title || `${v.handle}'s page`;
  for (const [path, body] of Object.entries(t.files({ handle: v.handle, title }))) {
    await deps.homes.write(v.userId, path, Buffer.from(body, 'utf8'), { maxFile: fileMaxBytes(deps), quota: quotaBytes(deps, v.role) });
  }
  await deps.db.query(`UPDATE homepages SET title = CASE WHEN title = '' THEN $2 ELSE title END WHERE user_id = $1`, [v.userId, title]);
  await refresh(deps, v.userId);
}

// An admin hides or restores a homepage (docs/03). Hidden pages are not served and not listed.
export async function setHidden(deps: AppDeps, admin: SessionUser, userId: string, hidden: boolean, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    await q.query(`INSERT INTO homepages (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    const r = await q.query<{ hidden_at: Date | null }>(`SELECT hidden_at FROM homepages WHERE user_id = $1 FOR UPDATE`, [userId]);
    if ((r.rows[0]!.hidden_at !== null) === hidden) throw new ApiError(409, 'no_change', hidden ? 'That homepage is already hidden.' : 'That homepage is not hidden.');
    await q.query(`UPDATE homepages SET hidden_at = ${hidden ? 'now()' : 'NULL'} WHERE user_id = $1`, [userId]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: hidden ? 'homepage.hidden' : 'homepage.restored', targetType: 'homepage', targetId: userId, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// Copies a library asset into the person's own files, so it is theirs, works offline, and is in their export.
export async function addAsset(deps: AppDeps, v: SessionUser, id: string): Promise<{ path: string }> {
  assertCanHost(v);
  const a = assetById(id);
  if (!a) throw new ApiError(404, 'not_found', 'No such asset.');
  const path = `assets/${a.id}.svg`;
  await deps.homes.write(v.userId, path, Buffer.from(a.svg, 'utf8'), { maxFile: fileMaxBytes(deps), quota: quotaBytes(deps, v.role) });
  await refresh(deps, v.userId);
  return { path };
}
