import { z } from 'zod';
import { tagListSchema } from './rings';

// Bookmarks (docs/21). Each is private, public, or shared into a ring the owner is in.
export const BOOKMARK_VISIBILITIES = ['private', 'public', 'ring'] as const;
export type BookmarkVisibility = (typeof BOOKMARK_VISIBILITIES)[number];
export const BOOKMARKS_MAX = 10_000;
export const BOOKMARK_TITLE_MAX = 200;
export const BOOKMARK_DESCRIPTION_MAX = 1000;
export const BOOKMARK_URL_MAX = 2000;

// Only http and https, and no name or password in the address (as for the wallpaper fetch).
export const bookmarkUrlSchema = z.string().trim().min(1, 'type or paste an address').max(BOOKMARK_URL_MAX, 'that address is too long')
  .transform((s) => (/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`))
  .refine((s) => { try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname; } catch { return false; } }, 'use an http or https address')
  .refine((s) => { const u = new URL(s); return !u.username && !u.password; }, 'leave the name and password out of the address');

const oneLine = (max: number) => z.string().trim().max(max).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'use plain text on one line');
const description = z.string().trim().max(BOOKMARK_DESCRIPTION_MAX).refine((s) => !/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s), 'use plain text');

export const bookmarkCreateSchema = z.object({
  url: bookmarkUrlSchema,
  title: oneLine(BOOKMARK_TITLE_MAX).optional(),
  description: description.optional(),
  tags: tagListSchema.default([]),
  pinned: z.boolean().default(false),
  visibility: z.enum(BOOKMARK_VISIBILITIES).default('private'),
  ring: z.string().trim().toLowerCase().max(32).optional(),   // the ring's address, when shared into a ring
}).refine((v) => v.visibility !== 'ring' || !!v.ring, { path: ['ring'], message: 'choose the ring to share it with' });
export const bookmarkUpdateSchema = z.object({
  url: bookmarkUrlSchema,
  title: oneLine(BOOKMARK_TITLE_MAX).min(1, 'give it a title'),
  description,
  tags: tagListSchema,
  pinned: z.boolean(),
  visibility: z.enum(BOOKMARK_VISIBILITIES),
  ring: z.string().trim().toLowerCase().max(32),
}).partial().refine((v) => Object.keys(v).length > 0, 'nothing to change')
  .refine((v) => v.visibility !== 'ring' || !!v.ring, { path: ['ring'], message: 'choose the ring to share it with' });

export const BOOKMARK_SORTS = ['newest', 'oldest', 'title', 'pinned'] as const;
export type BookmarkSort = (typeof BOOKMARK_SORTS)[number];

export const bookmarkListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().toLowerCase().max(20).optional(),
  // Several tags, comma-separated: bookmarks with all of them.
  tags: z.string().trim().toLowerCase().max(200).transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10)).optional(),
  sort: z.enum(BOOKMARK_SORTS).default('newest'),
  pinned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  broken: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),   // links that did not answer when last checked
  before: z.string().max(400).optional(),        // the `next` cursor from the last page
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export interface BookmarkView {
  id: string; url: string; title: string; description: string; tags: string[]; pinned: boolean;
  visibility: BookmarkVisibility; ring: { slug: string; name: string } | null;
  host: string; has_icon: boolean; created_at: string; updated_at: string;
  link_ok: boolean | null; checked_at: string | null;
  hidden: { reason: string } | null;          // a moderator took it down: the owner still sees it, nobody else does
  fetching: boolean;                           // just saved: its page's title, description and icon are still being read
}
// A bookmark as other people see it: on a profile, a ring page or in a feed.
export interface SharedBookmarkView {
  id: string; url: string; title: string; description: string; tags: string[]; host: string; has_icon: boolean; created_at: string;
  visibility: 'public' | 'ring'; ring: { slug: string; name: string } | null;
  owner: { id: string; handle: string; display_name: string | null };
  can_hide: boolean;                           // admins, and the ring's ops for a ring bookmark
}
export interface SharedBookmarkPage { bookmarks: SharedBookmarkView[]; next: string | null }
// What importing a browser bookmarks file did.
export interface BookmarkImportResult { added: number; existing: number; invalid: number; too_many: number }

// A shared link or the text a phone's Share menu sends: the page's address is often inside `text`, after the title.
export function sharedAddress(input: { url?: string | null; text?: string | null; title?: string | null }): { url: string; title: string } {
  const url = (input.url ?? '').trim();
  const text = (input.text ?? '').trim();
  const found = url || /https?:\/\/[^\s<>"']+/i.exec(text)?.[0] || '';
  const rest = text.replace(found, '').replace(/\s+/g, ' ').trim();
  return { url: found, title: (input.title ?? '').trim() || (url ? '' : rest) };
}

export interface BookmarkPage { bookmarks: BookmarkView[]; next: string | null; total: number }

// The parts of an address that only say where someone came from. Dropped when comparing addresses for duplicates;
// what is stored is what the person gave.
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|yclid|mkt_tok)$/i;
export function bookmarkKey(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.searchParams.size ? `?${u.searchParams.toString()}` : ''}`;
  if (u.pathname === '/' && !u.searchParams.size) s = s.slice(0, -1);
  return s;
}

// A bookmarklet: opens the add form with this page's address and title filled in. It only fills in the form.
export function bookmarkletSource(origin: string): string {
  return `javascript:(()=>{window.open(${JSON.stringify(`${origin}/bookmarks/add`)}+'?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank','width=560,height=640')})()`;
}
