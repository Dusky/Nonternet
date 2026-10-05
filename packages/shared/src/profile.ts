import { z } from 'zod';

// Themes are token sets in packages/ui-themes (docs/10). The names live here so the API can
// validate a choice without depending on the UI package.
export const THEMES = ['webring', 'after-dark', 'terminal', 'platinum', 'aqua'] as const;
export type ThemeName = (typeof THEMES)[number];
export const DEFAULT_THEME_NAME: ThemeName = 'webring';
// Names used before the 2026-10 restyle. A saved or configured old name still works and means its successor.
export const LEGACY_THEMES: Record<string, ThemeName> = { modern: 'webring', amber: 'terminal' };
export const themeSchema = z.preprocess((v) => (typeof v === 'string' && v in LEGACY_THEMES ? LEGACY_THEMES[v] : v), z.enum(THEMES));
// The Terminal theme comes in several phosphor colours (docs/10).
export const TERMINAL_SCHEMES = ['amber', 'green', 'white', 'ice', 'ansi', 'amber-magenta', 'paper', 'dusk'] as const;
export type TerminalScheme = (typeof TERMINAL_SCHEMES)[number];
export const themeVariantSchema = z.enum(TERMINAL_SCHEMES);

export const PLAN_MAX = 2000;

// Editing your own profile. Send only what changes. An empty display name or bio clears it.
export const profileUpdateSchema = z
  .object({
    display_name: z.string().trim().max(60).nullable(),
    bio: z.string().trim().max(500).nullable(),
    theme: themeSchema.nullable(),
    theme_variant: themeVariantSchema.nullable(),
    // A short line under the name. No control characters (a newline would break the single-line places it appears).
    status_line: z.string().trim().max(80).regex(/^[^\p{C}]*$/u, 'no line breaks or control characters').nullable(),
    // The .plan finger shows (docs/02): plain text over several lines. Tabs and line breaks are kept; other control
    // characters (which could move a terminal's cursor) are refused.
    plan: z.string().max(PLAN_MAX, `keep the plan to ${PLAN_MAX} characters`).transform((s) => s.replace(/\r\n?/g, '\n').replace(/\s+$/, ''))
      .refine((s) => /^[^\p{C}]*$/u.test(s.replace(/[\n\t]/g, '')), 'no control characters'),
    away: z.boolean(),
    show_last_seen: z.boolean(),
    email_digest: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

// Notifications you can switch off, by kind. Off means none is made: not in the list, not in the badge, not as a browser alert.
export const PREF_KINDS = ['reply', 'mention', 'watch'] as const;
export const notificationPrefSchema = z.object({ kind: z.enum(PREF_KINDS), enabled: z.boolean() });
export type NotificationPrefs = Record<(typeof PREF_KINDS)[number], boolean>;

// Everything the Settings pages need that is not on `Me`.
export interface PersonalSettings {
  status_line: string | null; plan: string; away: boolean; has_avatar: boolean; show_last_seen: boolean; email_digest: boolean; can_email: boolean;
  prefs: NotificationPrefs; muted_boards: { slug: string; name: string }[];
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 256;

export interface DirectoryEntry {
  id: string; handle: string; display_name: string | null; role: 'user' | 'trusted' | 'admin'; status_line: string | null; away: boolean;
  last_seen: LastSeen | null;
}
export type LastSeen = 'today' | 'this_week' | 'a_while';
