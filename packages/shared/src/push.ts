import { z } from 'zod';

// Push notifications (docs/10, docs/13): what a device can be told about, and how a browser signs up.
export const PUSH_KINDS = ['mail', 'reply', 'mention', 'watch'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export const MAX_PUSH_DEVICES = 10;

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'a push address must use https'),
  keys: z.object({ p256dh: z.string().min(16).max(200), auth: z.string().min(8).max(100) }),
  kinds: z.array(z.enum(PUSH_KINDS)).max(PUSH_KINDS.length),
  label: z.string().trim().max(60).optional(),
});
export const pushUpdateSchema = z.object({ kinds: z.array(z.enum(PUSH_KINDS)).max(PUSH_KINDS.length) });
export const pushDeviceSchema = z.object({
  id: z.string(), endpoint: z.string(), label: z.string(), kinds: z.array(z.enum(PUSH_KINDS)), created_at: z.string(), last_used_at: z.string().nullable(),
});
export type PushDevice = z.infer<typeof pushDeviceSchema>;

// The site's mark: the tab icon and the installed app's icon. Colours are hex only; anything else falls back.
export const MARK_COLOURS = { accent: '#2b4fd6', bg: '#f4f2ec' } as const;
const safeColour = (c: string, fallback: string) => (/^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : fallback);
export function siteMarkSvg(opts: { accent?: string; bg?: string; badge?: boolean; square?: boolean } = {}): string {
  const accent = safeColour(opts.accent ?? '', MARK_COLOURS.accent);
  const bg = safeColour(opts.bg ?? '', MARK_COLOURS.bg);
  // `square` fills the whole tile, for an icon the phone crops to its own shape (a "maskable" icon).
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${opts.square ? 0 : 14}" fill="${bg}"/>`
    + `<rect x="22" y="14" width="20" height="36" rx="2" fill="${accent}"/>`
    + (opts.badge ? `<circle cx="50" cy="14" r="11" fill="#d92d20" stroke="${bg}" stroke-width="4"/>` : '')
    + '</svg>';
}
