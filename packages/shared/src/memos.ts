import { z } from 'zod';

// Memos (docs/22): short notes in a timeline, private unless shared.
export const MEMO_MAX = 2000;
export const MEMOS_PER_PERSON = 50_000;
export const MEMO_TAGS_MAX = 5;
export const MEMO_VISIBILITIES = ['private', 'public', 'ring'] as const;
export type MemoVisibility = (typeof MEMO_VISIBILITIES)[number];

// The #tags in a memo's text: 2 to 20 lowercase letters, digits and hyphens (the ring-tag shape). A # inside a web address or
// code doesn't count, and neither does an entity like &#39;. At most five are kept.
export function extractTags(body: string): string[] {
  const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const out: string[] = [];
  for (const m of text.matchAll(/(^|[^\w&#/\-])#([a-z0-9][a-z0-9-]{1,19})(?![\w-])/gi)) {
    const tag = m[2]!.toLowerCase();
    if (!out.includes(tag)) out.push(tag);
    if (out.length >= MEMO_TAGS_MAX) break;
  }
  return out;
}

const bodyText = z.string().trim().min(1, 'write something first').max(MEMO_MAX, `memos can be up to ${MEMO_MAX} characters`);

export const memoCreateSchema = z.object({
  body: bodyText,
  pinned: z.boolean().default(false),
  visibility: z.literal('private').default('private'),   // sharing arrives with M3
});
export const memoUpdateSchema = z.object({
  body: bodyText,
  pinned: z.boolean(),
}).partial().refine((v) => Object.keys(v).length > 0, 'nothing to change');

export const memoListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().toLowerCase().max(20).optional(),
  pinned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  before: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export interface MemoView {
  id: string; body: string; tags: string[]; pinned: boolean; visibility: MemoVisibility; ring: { slug: string; name: string } | null;
  created_at: string; edited_at: string | null;
}
export interface MemoPage { memos: MemoView[]; next: string | null; total: number }
