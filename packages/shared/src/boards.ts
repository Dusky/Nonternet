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
  ring: { slug: string; name: string } | null;   // set on a ring's board
  owner: { id: string; handle: string };
  archived: boolean; hidden: boolean;
  thread_count: number; post_count: number; last_post_at: string | null;
  // The rest are about the viewer and are null or false when logged out.
  unread: number | null; watching: boolean; can_post: boolean; can_moderate: boolean;
}

export interface PostView {
  id: string; seq: number; board_id: string; thread_id: string; reply_to_id: string | null;
  subject: string; body: string | null; state: 'ok' | 'deleted' | 'removed' | 'hidden';
  // `character` is the MUD character the author features, if any (docs/09).
  author: { id: string; handle: string; display_name: string | null; character: { id: string; name: string; level: number } | null } | null;
  posted_at: string; edited_at: string | null;
}

export interface ThreadSummary {
  id: string; subject: string; author: PostView['author']; posted_at: string;
  reply_count: number; last_post_at: string; last_seq: number; unread: boolean; locked: boolean; state: PostView['state'];
}

export interface PostPreview {
  stored: string;            // exactly what would be saved
  wrapped: string[];         // the same text as a 79-column terminal shows it
  warnings: string[];        // things a classic terminal cannot show
}

export const NOTIFICATION_KINDS = ['reply', 'mention', 'watch'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationView {
  id: string; kind: NotificationKind; at: string; read: boolean;
  board: { slug: string; name: string }; thread_id: string; post_id: string; subject: string;
  actor: { id: string; handle: string; display_name: string | null };
}

export const notificationsReadSchema = z.union([
  z.object({ ids: z.array(z.string().regex(/^n_[0-9A-Z]{26}$/)).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

// ---------------------------------------------------------------- moderation (docs/03)
export const MOD_ACTIONS = ['hide', 'unhide', 'lock', 'unlock', 'remove', 'move'] as const;
export type ModAction = (typeof MOD_ACTIONS)[number];
export const UNDOABLE_MOD_ACTIONS: readonly ModAction[] = ['hide', 'lock', 'move'];

const reasonText = z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500);
export const modActionSchema = z.object({
  action: z.enum(MOD_ACTIONS),
  post_id: z.string().regex(/^p_[0-9A-Z]{26}$/),
  reason: reasonText,
  to_board: slugSchema.optional(),
}).refine((v) => v.action !== 'move' || v.to_board, { path: ['to_board'], message: 'choose the board to move it to' });
export const modUndoSchema = z.object({ reason: reasonText.optional() });

export const REPORT_CATEGORIES = ['spam', 'abuse', 'illegal', 'other'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
const reportDetails = { category: z.enum(REPORT_CATEGORIES), note: z.string().trim().max(500).default('') };
// What is being reported: a post, a homepage (by handle) or a guestbook entry.
export const reportCreateSchema = z.union([
  z.object({ post_id: z.string().regex(/^p_[0-9A-Z]{26}$/), ...reportDetails }),
  z.object({ homepage: z.string().trim().min(1).max(40), ...reportDetails }),
  z.object({ guestbook_entry: z.string().regex(/^g_[0-9A-Z]{26}$/), ...reportDetails }),
]);
export const reportResolveSchema = z.object({
  resolution: z.enum(['actioned', 'dismissed']),
  note: z.string().trim().max(500).optional(),
});
export const boardOpAddSchema = z.object({ handle: z.string().trim().min(1).max(40), reason: z.string().trim().max(500).optional() });

export interface ModLogEntry {
  id: string; at: string; action: ModAction; reason: string; undone: boolean; undoable: boolean;
  actor: { handle: string }; board: { slug: string; name: string };
  post_id: string; post_author: string | null; detail: Record<string, unknown> | null;
}

export interface ReportView {
  id: string; status: 'open' | 'actioned' | 'dismissed'; category: ReportCategory; note: string; at: string;
  escalated: boolean; other_open: number;
  reporter: { handle: string };
  board: { slug: string; name: string };
  target: { type: 'post' | 'homepage' | 'guestbook' | 'mail_message'; id: string; handle: string | null };
  post: { id: string; thread_id: string; subject: string; excerpt: string; state: PostView['state']; author: string | null } | null;
  excerpt: string;   // the reported words: a post, a guestbook entry, or a homepage's title
  resolved_by: string | null; resolved_at: string | null; resolution_note: string | null;
}
