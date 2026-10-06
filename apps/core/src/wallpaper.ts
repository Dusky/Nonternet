import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { WALLPAPER_MAX_BYTES, WALLPAPER_MAX_WIDTH, isWallpaperPattern, type SiteConfig, type WallpaperFit, type WallpaperSettings } from '@app/shared';
import type { SessionUser } from './accounts';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { safeFetch } from './safe-fetch';

// The desktop wallpaper (docs/10). Kept on the account so it follows the person to other devices. Their own picture
// is shown only to them, so it is not public content: no reports, no audit, but it is theirs and goes in the export.
// A picture from a web address is copied once, here, so the shell never loads anything from another site (the
// content policy stays 'self', and the other site never learns who looks at it).

const filePath = (deps: AppDeps, userId: string) => join(deps.filesDir, 'wallpapers', `${userId}.webp`);

const presetOf = (cfg: SiteConfig, choice: string) => choice.startsWith('preset:') ? cfg.ui.wallpapers.find((w) => w.id === choice.slice(7)) : undefined;

// A choice this site can still show: a pattern, one of the operator's pictures (they can be taken away), or "own".
const offered = (cfg: SiteConfig, choice: string) => isWallpaperPattern(choice) || choice === 'own' || !!presetOf(cfg, choice);

export async function getSettings(deps: Pick<AppDeps, 'db' | 'config'>, userId: string, q: Queryable = deps.db): Promise<WallpaperSettings> {
  const r = (await q.query<{ wallpaper: string | null; wallpaper_fit: WallpaperFit; wallpaper_at: Date | null; wallpaper_url: string | null }>(
    `SELECT wallpaper, wallpaper_fit, wallpaper_at, wallpaper_url FROM users WHERE id = $1`, [userId])).rows[0];
  if (!r) throw new ApiError(404, 'not_found', 'No such person.');
  const own = r.wallpaper_at ? { version: r.wallpaper_at.getTime(), source_url: r.wallpaper_url } : null;
  // Nothing chosen, "own" with no picture left, or a site picture the operator took away: the site's default.
  const choice = r.wallpaper && offered(deps.config, r.wallpaper) && !(r.wallpaper === 'own' && !own) ? r.wallpaper : deps.config.ui.default_wallpaper;
  return { choice, fit: r.wallpaper_fit, own };
}

export async function choose(deps: AppDeps, v: SessionUser, choice: string, fit: WallpaperFit): Promise<WallpaperSettings> {
  if (choice.startsWith('preset:') && !presetOf(deps.config, choice)) throw new ApiError(400, 'unknown_wallpaper', 'This site does not have that wallpaper.');
  if (choice === 'own') {
    const has = await deps.db.query(`SELECT 1 FROM users WHERE id = $1 AND wallpaper_at IS NOT NULL`, [v.userId]);
    if (!has.rowCount) throw new ApiError(409, 'no_picture', 'Upload a picture first.');
  }
  await deps.db.query(`UPDATE users SET wallpaper = $2, wallpaper_fit = $3 WHERE id = $1`, [v.userId, choice, fit]);
  return getSettings(deps, v.userId);
}

// Decoded and drawn again: what is kept is a plain WebP no wider than 2560 pixels, with no metadata or animation.
async function store(deps: AppDeps, userId: string, data: Buffer, sourceUrl: string | null): Promise<WallpaperSettings> {
  if (!data.length) throw new ApiError(400, 'empty', 'Choose a picture to upload.');
  if (data.length > WALLPAPER_MAX_BYTES) throw new ApiError(413, 'too_big', 'That picture is too big. Wallpapers can be up to 8 MB.');
  let out: Buffer;
  try {
    const img = sharp(data, { limitInputPixels: 50_000_000, failOn: 'error' });
    const meta = await img.metadata();
    if (!meta.format || !['png', 'jpeg', 'webp', 'gif'].includes(meta.format)) throw new Error('format');
    out = await img.rotate().resize({ width: WALLPAPER_MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new ApiError(400, 'bad_image', 'That does not look like a PNG, JPEG, GIF or WebP picture.');
  }
  await fs.mkdir(join(deps.filesDir, 'wallpapers'), { recursive: true });
  await fs.writeFile(filePath(deps, userId), out);
  await deps.db.query(`UPDATE users SET wallpaper = 'own', wallpaper_at = now(), wallpaper_url = $2 WHERE id = $1`, [userId, sourceUrl]);
  return getSettings(deps, userId);
}

export const upload = (deps: AppDeps, v: SessionUser, data: Buffer) => store(deps, v.userId, data, null);

export async function fromUrl(deps: AppDeps, v: SessionUser, url: string, opts: { allowPrivate?: boolean } = {}): Promise<WallpaperSettings> {
  const f = await safeFetch(url, { maxBytes: WALLPAPER_MAX_BYTES, accept: 'image/*', allowPrivate: opts.allowPrivate });
  return store(deps, v.userId, f.data, url);
}

export async function read(deps: AppDeps, userId: string): Promise<{ data: Buffer; version: number } | null> {
  const r = await deps.db.query<{ at: Date | null }>(`SELECT wallpaper_at AS at FROM users WHERE id = $1`, [userId]);
  const at = r.rows[0]?.at;
  if (!at) return null;
  try { return { data: await fs.readFile(filePath(deps, userId)), version: at.getTime() }; } catch { return null; }
}

// Removes their own picture (and goes back to the site's default if it was in use). Also used when the account is deleted.
export async function removeOwn(deps: AppDeps, userId: string, q: Queryable = deps.db): Promise<void> {
  await q.query(`UPDATE users SET wallpaper = CASE WHEN wallpaper = 'own' THEN NULL ELSE wallpaper END, wallpaper_at = NULL, wallpaper_url = NULL WHERE id = $1`, [userId]);
  await fs.rm(filePath(deps, userId), { force: true });
}

// For import: put back a picture from an export.
export const restore = (deps: AppDeps, userId: string, data: Buffer, sourceUrl: string | null) => store(deps, userId, data, sourceUrl);

// The site's own pictures (`ui.wallpapers`), public like the rest of the shell's files. The small version for the
// picker is made once and kept in memory.
const thumbs = new Map<string, Buffer>();
export async function readPreset(deps: AppDeps, id: string, thumb: boolean): Promise<{ data: Buffer; type: string } | null> {
  const p = deps.config.ui.wallpapers.find((w) => w.id === id);
  if (!p) return null;
  let data: Buffer;
  try { data = await fs.readFile(join(deps.wallpapersDir, p.file)); } catch { return null; }
  if (!thumb) return { data, type: TYPES[p.file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream' };
  const key = `${id}:${data.length}`;
  let t = thumbs.get(key);
  if (!t) {
    t = await sharp(data, { limitInputPixels: 100_000_000 }).resize(p.fit === 'tile' ? { width: 240, withoutEnlargement: true } : { width: 240, height: 150, fit: 'cover' }).webp({ quality: 70 }).toBuffer();
    thumbs.set(key, t);
  }
  return { data: t, type: 'image/webp' };
}
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
