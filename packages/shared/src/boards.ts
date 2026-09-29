import { z } from 'zod';

// Boards and posts (docs/05). Posts are plain text so the terminal BBS can show every one.
export const BOARD_VISIBILITIES = ['public', 'members', 'ring', 'private'] as const;
export type BoardVisibility = (typeof BOARD_VISIBILITIES)[number];
// A board someone creates by hand can be any of these. Ring boards come with their ring (M3).
export const CREATABLE_VISIBILITIES = ['public', 'members', 'private'] as const;

export const SUBJECT_MAX = 71;      // what a classic terminal can show on one line beside a name
export const BODY_MAX = 20000;
export const TERMINAL_COLUMNS = 79;

const RESERVED_SLUGS = ['new', 'settings', 'search'];
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,31}$/, 'use 2 to 32 lowercase letters, digits and hyphens')
  .refine((s) => !RESERVED_SLUGS.includes(s), 'that address is reserved');

export const boardCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(2, 'give the board a name').max(60),
  description: z.string().trim().max(500).default(''),
  visibility: z.enum(CREATABLE_VISIBILITIES).default('public'),
});

export const boardUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(500),
    visibility: z.enum(CREATABLE_VISIBILITIES),
    archived: z.boolean(),
    // Admins only.
    category_id: z.string().regex(/^bc_[0-9A-Z]{26}$/).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');

export const postCreateSchema = z.object({
  // A new thread needs a subject. A reply may leave it out and inherit "Re: …".
  subject: z.string().max(200).optional(),
  body: z.string().max(BODY_MAX * 2),
  reply_to: z.string().regex(/^p_[0-9A-Z]{26}$/).optional(),
});

// Mark up to one post read, or the whole board.
export const readPointerSchema = z.union([
  z.object({ post_id: z.string().regex(/^p_[0-9A-Z]{26}$/) }),
  z.object({ all: z.literal(true) }),
]);
export const memberAddSchema = z.object({ handle: z.string().trim().min(1).max(40) });
export const categoryCreateSchema = z.object({ name: z.string().trim().min(2).max(40) });

export interface BoardSummary {
  id: string; slug: string; name: string; description: string; visibility: BoardVisibility;
  category: { id: string; name: string } | null;
  owner: { id: string; handle: string };
  archived: boolean; hidden: boolean;
  thread_count: number; post_count: number; last_post_at: string | null;
  // The rest are about the viewer and are null or false when logged out.
  unread: number | null; watching: boolean; can_post: boolean; can_moderate: boolean;
}

export interface PostView {
  id: string; seq: number; board_id: string; thread_id: string; reply_to_id: string | null;
  subject: string; body: string | null; state: 'ok' | 'deleted' | 'hidden';
  author: { id: string; handle: string; display_name: string | null } | null;
  posted_at: string; edited_at: string | null;
}

export interface ThreadSummary {
  id: string; subject: string; author: PostView['author']; posted_at: string;
  reply_count: number; last_post_at: string; last_seq: number; unread: boolean; state: PostView['state'];
}

export interface PostPreview {
  stored: string;            // exactly what would be saved
  wrapped: string[];         // the same text as a 79-column terminal shows it
  warnings: string[];        // things a classic terminal cannot show
}
