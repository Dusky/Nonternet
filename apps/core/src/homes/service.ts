import type { HomeFileEntry, HomepageSummary } from '@app/shared';
import { audit } from '../audit';
import type { AppDeps } from '../deps';
import { randomToken } from '../crypto';
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
  const r = await deps.db.query<{ title: string; description: string; guestbook_mode: 'open' | 'approval' | 'off'; size_bytes: string; file_count: number; has_index: boolean; last_updated_at: Date | null; hidden_at: Date | null }>(
    `SELECT title, description, guestbook_mode, size_bytes, file_count, has_index, last_updated_at, hidden_at FROM homepages WHERE user_id = $1`, [v.userId]);
  const h = r.rows[0]!;
  const tree = await deps.homes.tree(v.userId);
  return {
    homepage: {
      title: h.title, description: h.description, guestbook_mode: h.guestbook_mode, url: deps.homesUrl(v.handle), has_index: h.has_index,
      size_bytes: Number(h.size_bytes), quota_bytes: quotaBytes(deps, v.role), file_max_bytes: fileMaxBytes(deps), file_count: h.file_count,
      last_updated_at: h.last_updated_at ? h.last_updated_at.toISOString() : null, hidden: h.hidden_at !== null,
    },
    files: tree.map((e) => ({ ...e, editable: e.type === 'file' && isEditable(e.path) })),
  };
}

export async function updateSettings(deps: AppDeps, v: SessionUser, patch: { title?: string; description?: string; guestbook_mode?: 'open' | 'approval' | 'off' }): Promise<void> {
  assertCanHost(v);
  await ensureRow(deps, v.userId);
  await deps.db.query(`UPDATE homepages SET title = COALESCE($2, title), description = COALESCE($3, description), guestbook_mode = COALESCE($4, guestbook_mode) WHERE user_id = $1`, [v.userId, patch.title ?? null, patch.description ?? null, patch.guestbook_mode ?? null]);
}

export async function putFile(deps: AppDeps, v: SessionUser, path: string, data: Buffer): Promise<void> {
  assertCanHost(v);
  await deps.homes.write(v.userId, path, data, { maxFile: fileMaxBytes(deps), quota: quotaBytes(deps, v.role) });
  await refresh(deps, v.userId);
}

// The Studio's live preview: the editor sends the text as it is typed, and the homes server shows it at an address with
// this token in it. The token stays the same while the same file is open, so the preview frame only has to reload.
export async function putPreview(deps: AppDeps, v: SessionUser, path: string, data: Buffer): Promise<{ token: string }> {
  assertCanHost(v);
  if (!isEditable(path)) throw new ApiError(415, 'not_text', 'That kind of file cannot be previewed here.');
  if (data.length > fileMaxBytes(deps)) throw new ApiError(413, 'too_large', 'That file is too big.');
  const r = await deps.db.query<{ token: string }>(
    `INSERT INTO home_previews (user_id, token, path, body) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now(),
       token = CASE WHEN home_previews.path = EXCLUDED.path THEN home_previews.token ELSE EXCLUDED.token END, path = EXCLUDED.path
     RETURNING token`, [v.userId, randomToken(18), path, data.toString('utf8')]);
  return { token: r.rows[0]!.token };
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
    if (hidden) await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = $3 WHERE target_type = 'homepage' AND target_id = $1 AND status = 'open'`, [userId, admin.userId, `Hidden by an admin: ${reason}`]);
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

// ---------------------------------------------------------------- directory and admin views

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface DirectoryEntry { handle: string; display_name: string | null; title: string; description: string; url: string; updated: string | null }

export async function directory(deps: AppDeps, opts: { q?: string; sort?: 'recent' | 'name'; filter?: 'new'; ring?: string; limit?: number; offset?: number }): Promise<{ homepages: DirectoryEntry[]; next: number | null }> {
  const limit = Math.min(opts.limit ?? 24, 60);
  const offset = opts.offset ?? 0;
  const like = opts.q ? `%${escapeLike(opts.q)}%` : null;
  const r = await deps.db.query<{ handle: string; display_name: string | null; title: string; description: string; last_updated_at: Date | null }>(
    `SELECT u.handle, u.display_name, h.title, h.description, h.last_updated_at FROM homepages h JOIN users u ON u.id = h.user_id
     WHERE h.has_index AND h.hidden_at IS NULL AND u.status = 'active'
       AND ($1::text IS NULL OR h.title ILIKE $1 ESCAPE '\\' OR h.description ILIKE $1 ESCAPE '\\' OR u.handle ILIKE $1 ESCAPE '\\')
       AND ($4::boolean IS NOT TRUE OR h.created_at > now() - interval '7 days')
       AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM ring_members m JOIN rings r ON r.id = m.ring_id
            WHERE m.user_id = u.id AND m.status = 'member' AND r.slug = $5 AND r.archived_at IS NULL AND r.hidden_at IS NULL))
     ORDER BY ${opts.sort === 'name' ? 'lower(u.handle)' : opts.filter === 'new' ? 'h.created_at DESC, u.id' : 'h.last_updated_at DESC NULLS LAST, u.id'} OFFSET $2 LIMIT $3`, [like, offset, limit + 1, opts.filter === 'new', opts.ring ?? null]);
  const page = r.rows.slice(0, limit);
  return {
    homepages: page.map((x) => ({ handle: x.handle, display_name: x.display_name, title: x.title, description: x.description, url: deps.homesUrl(x.handle), updated: x.last_updated_at ? x.last_updated_at.toISOString() : null })),
    next: r.rows.length > limit ? offset + limit : null,
  };
}

export async function randomHomepage(deps: AppDeps): Promise<{ handle: string; url: string } | null> {
  const r = await deps.db.query<{ handle: string }>(
    `SELECT u.handle FROM homepages h JOIN users u ON u.id = h.user_id WHERE h.has_index AND h.hidden_at IS NULL AND u.status = 'active' ORDER BY random() LIMIT 1`);
  return r.rows[0] ? { handle: r.rows[0].handle, url: deps.homesUrl(r.rows[0].handle) } : null;
}

// For the admin console: every homepage, biggest problems first is up to the reader.
export async function adminList(deps: AppDeps, opts: { q?: string; hidden?: boolean; before?: string; limit?: number }) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const like = opts.q ? `%${escapeLike(opts.q)}%` : null;
  const r = await deps.db.query<{ user_id: string; handle: string; title: string; size_bytes: string; file_count: number; has_index: boolean; last_updated_at: Date | null; hidden_at: Date | null; guestbook_mode: string }>(
    `SELECT h.user_id, u.handle, h.title, h.size_bytes, h.file_count, h.has_index, h.last_updated_at, h.hidden_at, h.guestbook_mode
     FROM homepages h JOIN users u ON u.id = h.user_id
     WHERE ($1::text IS NULL OR u.handle ILIKE $1 ESCAPE '\\' OR h.title ILIKE $1 ESCAPE '\\')
       AND ($2::boolean IS NULL OR (h.hidden_at IS NOT NULL) = $2)
       AND ($3::text IS NULL OR h.user_id > $3)
     ORDER BY h.user_id LIMIT $4`, [like, opts.hidden ?? null, opts.before ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  return {
    homepages: page.map((x) => ({ user_id: x.user_id, handle: x.handle, title: x.title, size_bytes: Number(x.size_bytes), file_count: x.file_count, has_index: x.has_index,
      last_updated_at: x.last_updated_at ? x.last_updated_at.toISOString() : null, hidden: x.hidden_at !== null, guestbook_mode: x.guestbook_mode, url: deps.homesUrl(x.handle) })),
    next: r.rows.length > limit ? page[page.length - 1]!.user_id : null,
    totals: (await deps.db.query<{ homepages: string; bytes: string; hidden: string }>(`SELECT count(*) AS homepages, COALESCE(sum(size_bytes), 0) AS bytes, count(*) FILTER (WHERE hidden_at IS NOT NULL) AS hidden FROM homepages`)).rows[0],
  };
}
