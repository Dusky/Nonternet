import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { FILE_NAME_MAX, type FileAreaView, type FileUsage, type FileView, type Role } from '@app/shared';
import { audit } from './audit';
import { newId } from './crypto';
import { isUniqueViolation, type Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { Ctx, SessionUser } from './accounts';

// File areas (docs/05, M7). Admins make the areas; people with the area's upload role (trusted by default)
// upload; anyone who can read the area downloads. Files are always served as downloads (never shown
// inline), so nothing uploaded can run as a page on the site (docs/15). Each file is one file on disk
// named by its ID; the database has the name people see.

const MB = 1024 * 1024;
const RANK: Record<Role, number> = { guest: 0, user: 1, trusted: 2, admin: 3 };
type Viewer = SessionUser | null;
const member = (v: Viewer) => Boolean(v && !v.limited && v.role !== 'guest');

interface AreaRow { id: string; slug: string; name: string; description: string; visibility: 'public' | 'members'; upload_role: 'user' | 'trusted' | 'admin'; archived_at: Date | null; file_count: string; last_upload_at: Date | null }

const canUpload = (v: Viewer, a: Pick<AreaRow, 'upload_role' | 'archived_at'>) => Boolean(v && member(v) && !a.archived_at && RANK[v.role] >= RANK[a.upload_role]);
const areaView = (v: Viewer, a: AreaRow): FileAreaView => ({
  id: a.id, slug: a.slug, name: a.name, description: a.description, visibility: a.visibility, upload_role: a.upload_role,
  archived: !!a.archived_at, file_count: Number(a.file_count), last_upload_at: a.last_upload_at?.toISOString() ?? null, can_upload: canUpload(v, a),
});
const AREA_SELECT = `SELECT a.id, a.slug, a.name, a.description, a.visibility, a.upload_role, a.archived_at,
  (SELECT count(*) FROM files f WHERE f.area_id = a.id AND f.deleted_at IS NULL AND f.hidden_at IS NULL) AS file_count,
  (SELECT max(created_at) FROM files f WHERE f.area_id = a.id AND f.deleted_at IS NULL AND f.hidden_at IS NULL) AS last_upload_at
  FROM file_areas a`;

// Which areas a viewer may read: public ones for everyone, members-only ones for confirmed users.
const readable = (v: Viewer) => (member(v) ? `TRUE` : `a.visibility = 'public'`);

export async function listAreas(deps: AppDeps, v: Viewer): Promise<FileAreaView[]> {
  const admin = v?.role === 'admin';
  const r = await deps.db.query<AreaRow>(`${AREA_SELECT} WHERE ${readable(v)} ${admin ? '' : 'AND a.archived_at IS NULL'} ORDER BY a.name`);
  return r.rows.map((a) => areaView(v, a));
}

async function loadArea(q: Queryable, v: Viewer, slug: string): Promise<AreaRow> {
  const r = await q.query<AreaRow>(`${AREA_SELECT} WHERE a.slug = $1 AND ${readable(v)}`, [slug.toLowerCase()]);
  const a = r.rows[0];
  if (!a) throw new ApiError(404, 'not_found', 'No such file area.');
  return a;
}

interface FileRow { id: string; slug: string; name: string; title: string; description: string; size_bytes: string; sha256: string; downloads: number; created_at: Date; uploader_id: string | null; uploader: string | null; hidden_at: Date | null }
const FILE_SELECT = `SELECT f.id, a.slug, f.name, f.title, f.description, f.size_bytes, f.sha256, f.downloads, f.created_at, f.uploader_id, u.handle AS uploader, f.hidden_at
  FROM files f JOIN file_areas a ON a.id = f.area_id LEFT JOIN users u ON u.id = f.uploader_id AND u.status <> 'deleted'`;
const fileView = (v: Viewer, f: FileRow): FileView => ({
  id: f.id, area: f.slug, name: f.name, title: f.title, description: f.description, size_bytes: Number(f.size_bytes), sha256: f.sha256,
  downloads: f.downloads, uploaded_at: f.created_at.toISOString(), uploader: f.uploader_id && f.uploader ? { id: f.uploader_id, handle: f.uploader } : null,
  hidden: !!f.hidden_at, mine: Boolean(v && v.userId === f.uploader_id), download_url: `/api/v1/files/${f.id}/download`,
});
// A hidden file is still there for its uploader and admins, and nobody else.
// `$2` is always the viewer's ID (or NULL).
const visible = (v: Viewer) => (v?.role === 'admin' ? '($2::text IS NULL OR TRUE)' : `(f.hidden_at IS NULL OR f.uploader_id = $2)`);
const vid = (v: Viewer) => v?.userId ?? null;

export async function areaWithFiles(deps: AppDeps, v: Viewer, slug: string): Promise<{ area: FileAreaView; files: FileView[] }> {
  const a = await loadArea(deps.db, v, slug);
  const r = await deps.db.query<FileRow>(`${FILE_SELECT} WHERE f.area_id = $1 AND f.deleted_at IS NULL AND ${visible(v)} ORDER BY f.created_at DESC LIMIT 500`, [a.id, vid(v)]);
  return { area: areaView(v, a), files: r.rows.map((f) => fileView(v, f)) };
}

async function loadFile(q: Queryable, v: Viewer, id: string): Promise<FileRow & { area_id: string; visibility: string }> {
  const r = await q.query<FileRow & { area_id: string; visibility: string }>(
    `SELECT x.*, f.area_id, a.visibility FROM (${FILE_SELECT} WHERE f.id = $1 AND f.deleted_at IS NULL AND ${visible(v)}) x
     JOIN files f ON f.id = x.id JOIN file_areas a ON a.id = f.area_id WHERE ${readable(v)}`, [id, vid(v)]);
  const f = r.rows[0];
  if (!f) throw new ApiError(404, 'not_found', 'No such file.');
  return f;
}

export async function getFile(deps: AppDeps, v: Viewer, id: string): Promise<FileView> {
  return fileView(v, await loadFile(deps.db, v, id));
}

// A name people can download safely: no folders, nothing hidden, nothing a shell or a browser would trip on.
export function cleanFileName(input: string): string {
  const name = input.normalize('NFC').trim().replace(/\s+/g, '_');
  if (!name) throw new ApiError(400, 'bad_name', 'Give the file a name.');
  if ([...name].length > FILE_NAME_MAX) throw new ApiError(400, 'bad_name', `File names can be up to ${FILE_NAME_MAX} characters.`);
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.()+~-]*$/u.test(name) || name.includes('..')) {
    throw new ApiError(400, 'bad_name', 'File names can use letters, digits and _ . ( ) + ~ - and must start with a letter, digit or underscore.');
  }
  return name;
}

export async function usage(deps: AppDeps, v: SessionUser): Promise<FileUsage> {
  const r = await deps.db.query<{ n: string | null }>(`SELECT sum(size_bytes) AS n FROM files WHERE uploader_id = $1 AND deleted_at IS NULL`, [v.userId]);
  return { used_bytes: Number(r.rows[0]!.n ?? 0), quota_bytes: v.role === 'admin' ? null : Math.floor(deps.config.limits.file_quota_mb * MB), max_file_bytes: maxFileBytes(deps) };
}
export const maxFileBytes = (deps: AppDeps) => Math.floor(deps.config.limits.file_max_mb * MB);

export async function upload(deps: AppDeps, v: SessionUser, slug: string, input: { name: string; title: string; description: string }, body: Buffer): Promise<FileView> {
  const a = await loadArea(deps.db, v, slug);
  if (!canUpload(v, a)) {
    if (a.archived_at) throw new ApiError(409, 'archived', 'This file area is archived.');
    throw new ApiError(403, 'forbidden', a.upload_role === 'trusted' ? 'Only trusted people can upload here.' : a.upload_role === 'admin' ? 'Only admins can upload here.' : 'Confirm your email address to upload.');
  }
  const name = cleanFileName(input.name);
  if (body.length === 0) throw new ApiError(400, 'empty', 'That file is empty.');
  if (body.length > maxFileBytes(deps)) throw new ApiError(413, 'too_large', `Files can be up to ${deps.config.limits.file_max_mb} MB.`);
  const id = newId('f');
  const sha256 = createHash('sha256').update(body).digest('hex');
  await fs.mkdir(deps.filesDir, { recursive: true });
  const path = join(deps.filesDir, id);
  // Bytes first, then the row: a crash leaves at most an orphan file, never a row with nothing behind it.
  await fs.writeFile(`${path}.part`, body);
  try {
    await deps.db.tx(async (q) => {
      await q.query(`SELECT pg_advisory_xact_lock(hashtext('files:' || $1))`, [v.userId]); // one upload at a time per person, so the quota holds
      if (v.role !== 'admin') {
        const used = Number((await q.query<{ n: string | null }>(`SELECT sum(size_bytes) AS n FROM files WHERE uploader_id = $1 AND deleted_at IS NULL`, [v.userId])).rows[0]!.n ?? 0);
        if (used + body.length > deps.config.limits.file_quota_mb * MB) throw new ApiError(413, 'over_quota', `That would take you over your ${deps.config.limits.file_quota_mb} MB of file space. Delete something first.`);
      }
      try {
        await q.query(`INSERT INTO files (id, area_id, uploader_id, name, title, description, size_bytes, sha256) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, a.id, v.userId, name, input.title, input.description, body.length, sha256]);
      } catch (e) {
        if (isUniqueViolation(e)) throw new ApiError(409, 'name_taken', `There is already a file called ${name} here.`);
        throw e;
      }
      await fs.rename(`${path}.part`, path);
    });
  } catch (e) {
    await fs.rm(`${path}.part`, { force: true });
    throw e;
  }
  return getFile(deps, v, id);
}

// For the download route: where the bytes are and what to call them. Counting happens here too.
export async function openForDownload(deps: AppDeps, v: Viewer, id: string): Promise<{ path: string; name: string; size: number; sha256: string }> {
  const f = await loadFile(deps.db, v, id);
  await deps.db.query(`UPDATE files SET downloads = downloads + 1 WHERE id = $1`, [id]);
  return { path: join(deps.filesDir, f.id), name: f.name, size: Number(f.size_bytes), sha256: f.sha256 };
}

export async function updateFile(deps: AppDeps, v: SessionUser, id: string, patch: { title?: string; description?: string }): Promise<FileView> {
  const f = await loadFile(deps.db, v, id);
  if (f.uploader_id !== v.userId) throw new ApiError(403, 'forbidden', 'Only the person who uploaded this can change it.');
  await deps.db.query(`UPDATE files SET title = COALESCE($2, title), description = COALESCE($3, description) WHERE id = $1`, [id, patch.title ?? null, patch.description ?? null]);
  return getFile(deps, v, id);
}

export async function deleteFile(deps: AppDeps, v: SessionUser, id: string, reason: string | undefined, ctx: Ctx): Promise<void> {
  const f = await loadFile(deps.db, v, id);
  const own = f.uploader_id === v.userId;
  if (!own && v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only the person who uploaded this, or an admin, can delete it.');
  if (!own && !reason?.trim()) throw new ApiError(400, 'reason_required', 'Give a reason.');
  await deps.db.tx(async (q) => {
    await q.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [id]);
    await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = 'file deleted' WHERE target_type = 'file' AND target_id = $1 AND status = 'open'`, [id, v.userId]);
    if (!own) await audit(q, { actorId: v.userId, actorKind: 'user', action: 'file.deleted', targetType: 'file', targetId: id, before: { name: f.name, area: f.slug, uploader: f.uploader }, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
  });
  await fs.rm(join(deps.filesDir, id), { force: true });
}

export async function setHidden(deps: AppDeps, v: SessionUser, id: string, hidden: boolean, reason: string, ctx: Ctx): Promise<void> {
  if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can hide files.');
  await deps.db.tx(async (q) => {
    const f = await loadFile(q, v, id);
    if (!!f.hidden_at === hidden) throw new ApiError(409, 'no_change', hidden ? 'That file is already hidden.' : 'That file is not hidden.');
    await q.query(`UPDATE files SET hidden_at = ${hidden ? 'now()' : 'NULL'}, hidden_reason = $2 WHERE id = $1`, [id, hidden ? reason : null]);
    if (hidden) await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = 'file hidden' WHERE target_type = 'file' AND target_id = $1 AND status = 'open'`, [id, v.userId]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: hidden ? 'file.hidden' : 'file.unhidden', targetType: 'file', targetId: id, before: { name: f.name, area: f.slug }, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function reportFile(deps: AppDeps, v: SessionUser, id: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  const f = await loadFile(deps.db, v, id);
  if (f.uploader_id === v.userId) throw new ApiError(400, 'self', "You can't report your own file.");
  const rid = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, 'file', $2, 'site', 'site', $3, $4, $5)`, [rid, id, v.userId, category, note]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.created', targetType: 'file', targetId: id, after: { category }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'reports_one_open') throw new ApiError(409, 'already_reported', 'You already reported this. The admins have it.');
    throw err;
  }
  return { id: rid };
}

// ---------------------------------------------------------------- areas (admins)

export async function createArea(deps: AppDeps, v: SessionUser, input: { slug: string; name: string; description: string; visibility: 'public' | 'members'; upload_role: 'user' | 'trusted' | 'admin' }, ctx: Ctx): Promise<FileAreaView> {
  if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can make file areas.');
  const id = newId('fa');
  await deps.db.tx(async (q) => {
    try {
      await q.query(`INSERT INTO file_areas (id, slug, name, description, visibility, upload_role, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, input.slug, input.name, input.description, input.visibility, input.upload_role, v.userId]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, 'slug_taken', 'That address is taken.');
      throw e;
    }
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'file_area.created', targetType: 'file_area', targetId: id, after: input, origin: 'web', ipHash: ctx.ipHash });
  });
  return areaView(v, await loadArea(deps.db, v, input.slug));
}

export async function updateArea(deps: AppDeps, v: SessionUser, slug: string, patch: { name?: string; description?: string; visibility?: 'public' | 'members'; upload_role?: 'user' | 'trusted' | 'admin'; archived?: boolean }, ctx: Ctx): Promise<FileAreaView> {
  if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can change file areas.');
  await deps.db.tx(async (q) => {
    const a = await loadArea(q, v, slug);
    await q.query(
      `UPDATE file_areas SET name = COALESCE($2, name), description = COALESCE($3, description), visibility = COALESCE($4, visibility), upload_role = COALESCE($5, upload_role),
         archived_at = CASE WHEN $6::boolean IS NULL THEN archived_at WHEN $6 THEN COALESCE(archived_at, now()) ELSE NULL END WHERE id = $1`,
      [a.id, patch.name ?? null, patch.description ?? null, patch.visibility ?? null, patch.upload_role ?? null, patch.archived ?? null]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'file_area.updated', targetType: 'file_area', targetId: a.id,
      before: { name: a.name, description: a.description, visibility: a.visibility, upload_role: a.upload_role, archived: !!a.archived_at }, after: patch, origin: 'web', ipHash: ctx.ipHash });
  });
  return areaView(v, await loadArea(deps.db, v, slug));
}

// Account deletion (docs/12): their uploads go, like their homepage. Rows stay as tombstones.
export async function removeAllFor(q: Queryable, userId: string): Promise<string[]> {
  const r = await q.query<{ id: string }>(`UPDATE files SET deleted_at = now(), uploader_id = NULL WHERE uploader_id = $1 AND deleted_at IS NULL RETURNING id`, [userId]);
  await q.query(`UPDATE files SET uploader_id = NULL WHERE uploader_id = $1`, [userId]);
  return r.rows.map((x) => x.id);
}
