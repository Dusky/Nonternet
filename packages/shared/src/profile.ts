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
    // A short line under the name. No control characters (a newline would break the single-line places it appears).
    status_line: z.string().trim().max(80).regex(/^[^\p{C}]*$/u, 'no line breaks or control characters').nullable(),
    away: z.boolean(),
    show_last_seen: z.boolean(),
    email_digest: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

// Notifications you can switch off, by kind. "site" is the bell and the list; "desktop" is the browser alert.
export const PREF_KINDS = ['reply', 'mention', 'watch'] as const;
export const notificationPrefSchema = z.object({ kind: z.enum(PREF_KINDS), site: z.boolean().optional(), desktop: z.boolean().optional() })
  .refine((v) => v.site !== undefined || v.desktop !== undefined, 'nothing to change');
export type NotificationPrefs = Record<(typeof PREF_KINDS)[number], { site: boolean; desktop: boolean }>;

// Everything the Settings pages need that is not on `Me`.
export interface PersonalSettings {
  status_line: string | null; away: boolean; has_avatar: boolean; show_last_seen: boolean; email_digest: boolean; can_email: boolean;
  prefs: NotificationPrefs; muted_boards: { slug: string; name: string }[];
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 256;

export interface DirectoryEntry {
  id: string; handle: string; display_name: string | null; role: 'user' | 'trusted' | 'admin'; status_line: string | null; away: boolean;
  last_seen: LastSeen | null;
}
export type LastSeen = 'today' | 'this_week' | 'a_while';
