import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { IMAGES_PER_POST, IMAGE_MAX_SIDE, IMAGE_UPLOAD_MAX_BYTES, imageIds, type UploadedImage } from '@app/shared';
import type { SessionUser } from './accounts';
import { audit } from './audit';
import { canModerate, isMember, loadBoard } from './boards';
import { newId } from './crypto';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';

// Pictures in posts and mail (docs/23, E6). Every upload is decoded and drawn again as a plain WebP, so no metadata (place,
// camera) and nothing the browser could be tricked by is kept; a GIF becomes its first frame. A picture starts as the
// uploader's own, and becomes part of a post or a mail message when that is saved with the picture's address in its text.
// From then on it can be seen by exactly the people who can see that post or message.
const MB = 1024 * 1024;
const pathOf = (deps: AppDeps, id: string) => join(deps.filesDir, 'images', `${id}.webp`);
const notFound = () => new ApiError(404, 'not_found', 'No such picture.');

export async function uploadImage(deps: AppDeps, v: SessionUser, data: Buffer, alt = ''): Promise<UploadedImage> {
  if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
  if (v.limited) throw new ApiError(403, 'totp_setup_required', 'Set up two-factor authentication to continue.');
  if (!data.length) throw new ApiError(400, 'empty', 'Choose a picture to upload.');
  if (data.length > IMAGE_UPLOAD_MAX_BYTES) throw new ApiError(413, 'too_big', `That picture is too big. Pictures can be up to ${IMAGE_UPLOAD_MAX_BYTES / MB} MB.`);
  let out: Buffer; let width: number; let height: number;
  try {
    const img = sharp(data, { limitInputPixels: 25_000_000, failOn: 'error' });
    const meta = await img.metadata();
    if (!meta.format || !['png', 'jpeg', 'webp', 'gif'].includes(meta.format)) throw new Error('format');
    const res = await img.rotate().resize(IMAGE_MAX_SIDE, IMAGE_MAX_SIDE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    out = res.data; width = res.info.width; height = res.info.height;
  } catch {
    throw new ApiError(400, 'bad_image', 'That does not look like a PNG, JPEG, WebP or GIF picture.');
  }
  const id = newId('i');
  await fs.mkdir(join(deps.filesDir, 'images'), { recursive: true });
  await fs.writeFile(`${pathOf(deps, id)}.part`, out);
  try {
    await deps.db.tx(async (q) => {
      await q.query(`SELECT pg_advisory_xact_lock(hashtext('files:' || $1))`, [v.userId]); // the same lock as file uploads, so the quota holds
      if (v.role !== 'admin') {
        const used = await usedBytes(q, v.userId);
        const quota = deps.config.limits.file_quota_mb * MB;
        if (used + out.length > quota) throw new ApiError(413, 'over_quota', `That would take you over your ${deps.config.limits.file_quota_mb} MB of file space. Delete something first.`);
      }
      await q.query(`INSERT INTO images (id, owner_id, alt, width, height, bytes) VALUES ($1, $2, $3, $4, $5, $6)`, [id, v.userId, alt.slice(0, 200), width, height, out.length]);
      await fs.rename(`${pathOf(deps, id)}.part`, pathOf(deps, id));
    });
  } catch (e) {
    await fs.rm(`${pathOf(deps, id)}.part`, { force: true });
    throw e;
  }
  void sweepStale(deps); // old unused uploads go whenever someone adds a new one
  return { id, width, height };
}

// File space in use: files in areas plus pictures.
export async function usedBytes(q: Queryable, userId: string): Promise<number> {
  const r = await q.query<{ n: string }>(
    `SELECT (SELECT COALESCE(sum(size_bytes), 0) FROM files WHERE uploader_id = $1 AND deleted_at IS NULL) + (SELECT COALESCE(sum(bytes), 0) FROM images WHERE owner_id = $1) AS n`, [userId]);
  return Number(r.rows[0]!.n);
}

// Called inside the transaction that saves a post or a message. The text's pictures must be the author's own and not used
// by anything else; they become part of this one. Pictures this one used before and the text no longer names are dropped.
// Returns the ids whose files should be deleted once the transaction has committed.
export async function attachImages(q: Queryable, userId: string, target: { post: string } | { mail: string }, body: string): Promise<string[]> {
  const col = 'post' in target ? 'post_id' : 'mail_message_id';
  const owner = 'post' in target ? target.post : target.mail;
  const ids = imageIds(body);
  if (ids.length > IMAGES_PER_POST) throw new ApiError(400, 'too_many_images', `Up to ${IMAGES_PER_POST} pictures in one ${'post' in target ? 'post' : 'message'}.`);
  const other = 'post' in target ? 'mail_message_id' : 'post_id';
  if (ids.length) {
    const usable = await q.query(`SELECT id FROM images WHERE id = ANY($2) AND owner_id = $3 AND ${other} IS NULL AND (${col} IS NULL OR ${col} = $1)`, [owner, ids, userId]);
    if (usable.rowCount !== ids.length) throw new ApiError(400, 'bad_image', 'One of the pictures is not yours to use here. Upload it again.');
    await q.query(`UPDATE images SET ${col} = $1 WHERE id = ANY($2)`, [owner, ids]);
  }
  const dropped = await q.query<{ id: string }>(`DELETE FROM images WHERE ${col} = $1 AND NOT (id = ANY($2)) RETURNING id`, [owner, ids]);
  return dropped.rows.map((x) => x.id);
}
export async function removeFiles(deps: AppDeps, ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => fs.rm(pathOf(deps, id), { force: true })));
}

// Unused uploads older than a day.
export async function sweepStale(deps: AppDeps): Promise<void> {
  try {
    const r = await deps.db.query<{ id: string }>(
      `DELETE FROM images WHERE id IN (SELECT id FROM images WHERE post_id IS NULL AND mail_message_id IS NULL AND created_at < now() - interval '1 day' LIMIT 100) RETURNING id`);
    await removeFiles(deps, r.rows.map((x) => x.id));
  } catch { /* the next upload tries again */ }
}

// Who may see a picture: the people who may see the post or the message it belongs to; before that, only its owner.
export async function readImage(deps: AppDeps, v: SessionUser | null, id: string): Promise<{ data: Buffer; public: boolean }> {
  const r = await deps.db.query<{ owner_id: string; post_id: string | null; mail_message_id: string | null; hidden_at: Date | null; slug: string | null; p_hidden: Date | null; p_deleted: Date | null; p_author: string | null; thread_id: string | null; m_deleted: Date | null }>(
    `SELECT i.owner_id, i.post_id, i.mail_message_id, i.hidden_at, b.slug, p.hidden_at AS p_hidden, p.deleted_at AS p_deleted, p.author_id AS p_author, m.thread_id, m.deleted_at AS m_deleted
       FROM images i LEFT JOIN posts p ON p.id = i.post_id LEFT JOIN boards b ON b.id = p.board_id LEFT JOIN mail_messages m ON m.id = i.mail_message_id WHERE i.id = $1`, [id]);
  const x = r.rows[0];
  if (!x) throw notFound();
  let isPublic = false;
  if (x.hidden_at && v?.role !== 'admin') throw notFound();
  if (x.post_id) {
    const b = await loadBoard(deps.db, x.slug!, v); // a board you cannot read does not exist for you
    if ((x.p_hidden || x.p_deleted) && !canModerate(v, b) && x.p_author !== v?.userId) throw notFound();
    isPublic = b.visibility === 'public';
  } else if (x.mail_message_id) {
    if (!v) throw notFound();
    const p = await deps.db.query(`SELECT 1 FROM mail_participants WHERE thread_id = $1 AND user_id = $2`, [x.thread_id, v.userId]);
    if (!p.rowCount || x.m_deleted) throw notFound();
  } else if (!v || v.userId !== x.owner_id) throw notFound();
  try { return { data: await fs.readFile(pathOf(deps, id)), public: isPublic }; } catch { throw notFound(); }
}

// An admin takes one picture down (or puts it back), with a reason on the record.
export async function hideImage(deps: AppDeps, v: SessionUser, id: string, hide: boolean, reason: string, ipHash?: string): Promise<void> {
  if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can do that.');
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE images SET hidden_at = CASE WHEN $2::boolean THEN COALESCE(hidden_at, now()) ELSE NULL END WHERE id = $1`, [id, hide]);
    if (!r.rowCount) throw notFound();
    await audit(q, { actorId: v.userId, actorKind: 'user', action: hide ? 'image.hidden' : 'image.restored', targetType: 'image', targetId: id, after: { reason }, origin: 'web', ipHash });
  });
}

// Everything a person uploaded goes (account deletion with "erase my posts").
export async function eraseImagesOf(q: Queryable, deps: AppDeps, userId: string): Promise<void> {
  const r = await q.query<{ id: string }>(`DELETE FROM images WHERE owner_id = $1 RETURNING id`, [userId]);
  await removeFiles(deps, r.rows.map((x) => x.id));
}
export const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
