import { z } from 'zod';

// The desktop wallpaper (docs/10): a drawn pattern, one of the site's pictures (the operator's), or a picture of the person's own
// (uploaded, or copied once from a web address). Kept on the account and shown only to its owner.
export const WALLPAPER_PATTERNS = ['dots', 'grid', 'stripes', 'plain'] as const;
export type WallpaperPattern = (typeof WALLPAPER_PATTERNS)[number];

export const WALLPAPER_FITS = ['cover', 'tile', 'center'] as const;
export type WallpaperFit = (typeof WALLPAPER_FITS)[number];

// The site's own pictures are chosen by the operator in the site config (`ui.wallpapers`), so whether a preset exists
// is checked by core against that list; here only the shape is checked. "dots" | "preset:{id}" | "own"
export const WALLPAPER_PRESET_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isWallpaperPattern = (v: string): v is WallpaperPattern => (WALLPAPER_PATTERNS as readonly string[]).includes(v);
export const wallpaperChoiceSchema = z.string().refine(
  (v) => isWallpaperPattern(v) || v === 'own' || (v.startsWith('preset:') && WALLPAPER_PRESET_ID.test(v.slice(7))),
  'not a wallpaper this site has',
);
export const wallpaperUpdateSchema = z.object({ choice: wallpaperChoiceSchema, fit: z.enum(WALLPAPER_FITS).default('cover') });
export const wallpaperFromUrlSchema = z.object({ url: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'use an http or https address') });

export interface WallpaperSettings {
  choice: string; // as wallpaperChoiceSchema
  fit: WallpaperFit;
  own: { version: number; source_url: string | null } | null; // the person's own picture, if they have one
}

export const WALLPAPER_MAX_BYTES = 8 * 1024 * 1024;
export const WALLPAPER_MAX_WIDTH = 2560;
