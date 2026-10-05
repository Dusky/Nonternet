import { z } from 'zod';

// The desktop wallpaper (docs/10): a drawn pattern, one of the site's pictures, or a picture of the person's own
// (uploaded, or copied once from a web address). Kept on the account and shown only to its owner.
export const WALLPAPER_PATTERNS = ['dots', 'grid', 'stripes', 'plain'] as const;
export type WallpaperPattern = (typeof WALLPAPER_PATTERNS)[number];

// The site's pictures, served by the shell from /wallpapers/{id}.webp. `tile` repeats; `cover` fills the screen.
export const WALLPAPER_PRESETS = [
  { id: 'paper-stars', fit: 'tile' },
  { id: 'slate-stars', fit: 'tile' },
  { id: 'hillside', fit: 'cover' },
  { id: 'harbour', fit: 'cover' },
  { id: 'lanterns', fit: 'cover' },
  { id: 'lantern-hill', fit: 'cover' },
  { id: 'tower', fit: 'cover' },
] as const;
export type WallpaperPresetId = (typeof WALLPAPER_PRESETS)[number]['id'];
export const WALLPAPER_FITS = ['cover', 'tile', 'center'] as const;
export type WallpaperFit = (typeof WALLPAPER_FITS)[number];

// "dots" | "preset:hillside" | "own"
const PRESET_IDS = WALLPAPER_PRESETS.map((p) => p.id) as string[];
export const wallpaperChoiceSchema = z.string().refine(
  (v) => (WALLPAPER_PATTERNS as readonly string[]).includes(v) || v === 'own' || (v.startsWith('preset:') && PRESET_IDS.includes(v.slice(7))),
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
