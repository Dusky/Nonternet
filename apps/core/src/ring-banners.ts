import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { SessionUser } from './accounts';
import { audit } from './audit';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { liveAll } from './live';

// Ring banners (M9-E, docs/06, 07): a ring can have a 468x60 and an 88x31 picture for member pages to show. They are drawn
// again on upload (so only a plain PNG is ever served), kept beside avatars, and can be taken down by the ring's ops or an admin.
export const BANNER_KINDS = { '468x60': [468, 60], '88x31': [88, 31] } as const;
export type BannerKind = keyof typeof BANNER_KINDS;
export const BANNER_MAX_BYTES = 1024 * 1024;

const pathOf = (deps: AppDeps, ringId: string, kind: BannerKind) => join(deps.filesDir, 'ring-banners', `${ringId}-${kind}.png`);

async function ringOf(deps: AppDeps, slug: string): Promise<{ id: string; hidden: boolean; archived: boolean }> {
  const r = await deps.db.query<{ id: string; hidden_at: Date | null; archived_at: Date | null }>(`SELECT id, hidden_at, archived_at FROM rings WHERE slug = $1`, [slug]);
  if (!r.rows[0]) throw new ApiError(404, 'not_found', 'No such ring.');
  return { id: r.rows[0].id, hidden: r.rows[0].hidden_at !== null, archived: r.rows[0].archived_at !== null };
}
const isOp = (v: SessionUser, ringId: string) => v.role === 'admin' || v.ops.includes(`ring:${ringId}`);
function mustOp(v: SessionUser, ringId: string): void {
  if (!isOp(v, ringId)) throw new ApiError(403, 'forbidden', 'Only the people who run this ring can change its banners.');
}

export async function setBanner(deps: AppDeps, v: SessionUser, slug: string, kind: BannerKind, data: Buffer): Promise<void> {
  const ring = await ringOf(deps, slug);
  mustOp(v, ring.id);
  if (ring.archived) throw new ApiError(409, 'archived', 'This ring is archived.');
  if (!data.length) throw new ApiError(400, 'empty', 'Choose a picture to upload.');
  if (data.length > BANNER_MAX_BYTES) throw new ApiError(413, 'too_big', 'That picture is too big. Banners can be up to 1 MB.');
  const [w, h] = BANNER_KINDS[kind];
  let out: Buffer;
  try {
    const img = sharp(data, { limitInputPixels: 25_000_000, failOn: 'error' });
    const meta = await img.metadata();
    if (!meta.format || !['png', 'jpeg', 'webp', 'gif'].includes(meta.format)) throw new Error('format');
    out = await img.resize(w, h, { fit: 'cover' }).png().toBuffer(); // a GIF becomes its first frame
  } catch {
    throw new ApiError(400, 'bad_image', 'That does not look like a PNG, JPEG, WebP or GIF picture.');
  }
  await fs.mkdir(join(deps.filesDir, 'ring-banners'), { recursive: true });
  await fs.writeFile(pathOf(deps, ring.id, kind), out);
  await deps.db.query(
    `INSERT INTO ring_banners (ring_id, kind, uploaded_by) VALUES ($1, $2, $3)
     ON CONFLICT (ring_id, kind) DO UPDATE SET uploaded_by = EXCLUDED.uploaded_by, updated_at = now(), hidden_at = NULL`, [ring.id, kind, v.userId]);
  liveAll({ type: 'classics' }, { confirmedOnly: true });
}

export async function removeBanner(deps: AppDeps, v: SessionUser, slug: string, kind: BannerKind): Promise<void> {
  const ring = await ringOf(deps, slug);
  mustOp(v, ring.id);
  await deps.db.query(`DELETE FROM ring_banners WHERE ring_id = $1 AND kind = $2`, [ring.id, kind]);
  await fs.rm(pathOf(deps, ring.id, kind), { force: true });
}

// A ring op or an admin takes a banner down (or puts it back) without deleting it, with a reason on the record.
export async function hideBanner(deps: AppDeps, v: SessionUser, slug: string, kind: BannerKind, hide: boolean, reason: string, ipHash?: string): Promise<void> {
  const ring = await ringOf(deps, slug);
  mustOp(v, ring.id);
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE ring_banners SET hidden_at = ${hide ? 'now()' : 'NULL'} WHERE ring_id = $1 AND kind = $2`, [ring.id, kind]);
    if (!r.rowCount) throw new ApiError(404, 'not_found', 'That ring has no such banner.');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: hide ? 'ring.banner_hidden' : 'ring.banner_restored', targetType: 'ring', targetId: ring.id, after: { kind, reason }, origin: 'web', ipHash });
  });
}

export async function listBanners(deps: AppDeps, v: SessionUser | null, slug: string): Promise<{ banners: { kind: BannerKind; hidden: boolean; version: number }[] }> {
  const ring = await ringOf(deps, slug);
  if (ring.hidden && v?.role !== 'admin') throw new ApiError(404, 'not_found', 'No such ring.');
  const r = await deps.db.query<{ kind: BannerKind; hidden_at: Date | null; updated_at: Date }>(`SELECT kind, hidden_at, updated_at FROM ring_banners WHERE ring_id = $1 ORDER BY kind`, [ring.id]);
  const ops = v ? isOp(v, ring.id) : false;
  // People who can't change a banner only hear about the ones that are showing.
  return { banners: r.rows.filter((b) => ops || !b.hidden_at).map((b) => ({ kind: b.kind, hidden: b.hidden_at !== null, version: b.updated_at.getTime() })) };
}

export async function readBanner(deps: AppDeps, slug: string, kind: BannerKind): Promise<Buffer | null> {
  const ring = await ringOf(deps, slug).catch(() => null);
  if (!ring || ring.hidden) return null;
  const r = await deps.db.query(`SELECT 1 FROM ring_banners WHERE ring_id = $1 AND kind = $2 AND hidden_at IS NULL`, [ring.id, kind]);
  if (!r.rowCount) return null;
  try { return await fs.readFile(pathOf(deps, ring.id, kind)); } catch { return null; }
}

export const bannerFile = (deps: AppDeps, ringId: string, kind: BannerKind) => pathOf(deps, ringId, kind);
