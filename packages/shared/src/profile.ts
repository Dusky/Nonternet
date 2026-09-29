import { z } from 'zod';

// Themes are token sets in packages/ui-themes (docs/10). The names live here so the API can
// validate a choice without depending on the UI package.
export const THEMES = ['modern', 'amber'] as const;
export const themeSchema = z.enum(THEMES);
export type ThemeName = z.infer<typeof themeSchema>;

// Editing your own profile. Send only what changes. An empty display name or bio clears it.
export const profileUpdateSchema = z
  .object({
    display_name: z.string().trim().max(60).nullable(),
    bio: z.string().trim().max(500).nullable(),
    theme: themeSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
