import { z } from 'zod';
import { roleSchema } from './roles';

// Domain events on the bus (docs/14). Delivery is at-least-once, so consumers must be idempotent:
// use `id` to skip an event already handled, and `role_rev` to ignore a stale role or ops change
// that arrives after a newer one.
const userId = z.string().regex(/^u_[0-9A-Z]{26}$/);
const boardId = z.string().regex(/^b_[0-9A-Z]{26}$/);
const postId = z.string().regex(/^p_[0-9A-Z]{26}$/);

export const eventPayloads = {
  'user.created': z.object({ user_id: userId, handle: z.string(), role: roleSchema }),
  'user.role_changed': z.object({ user_id: userId, role: roleSchema, previous_role: roleSchema, role_rev: z.number().int() }),
  'user.ops_changed': z.object({ user_id: userId, ops: z.array(z.string()), role_rev: z.number().int() }),
  'user.renamed': z.object({ user_id: userId, handle: z.string(), previous_handle: z.string(), role_rev: z.number().int() }),
  'user.suspended': z.object({ user_id: userId }),
  'user.unsuspended': z.object({ user_id: userId }),
  // Every session of the user was ended (suspension, password reset, 2FA reset), or one session
  // was (logout). Services drop matching live connections.
  'session.revoked': z.object({ user_id: userId, session_id: z.string().optional(), reason: z.string() }),
  // Boards (docs/05). `visibility` lets a consumer such as IRC skip anything not public.
  'board.created': z.object({ board_id: boardId, slug: z.string(), owner_id: userId, visibility: z.string() }),
  'post.created': z.object({ post_id: postId, board_id: boardId, thread_id: postId, author_id: userId, visibility: z.string() }),
  // A moderator acted on a post or thread (docs/03).
  'mod.action': z.object({ action: z.string(), board_id: boardId, post_id: postId, actor_id: userId }),
  'ring.created': z.object({ ring_id: z.string().regex(/^r_[0-9A-Z]{26}$/), slug: z.string(), founder_id: userId }),
  'ring.member_changed': z.object({ ring_id: z.string().regex(/^r_[0-9A-Z]{26}$/), user_id: userId, status: z.enum(['pending', 'invited', 'member', 'banned', 'removed']) }),
  'post.deleted': z.object({ post_id: postId, board_id: boardId }),
} as const;

export type EventType = keyof typeof eventPayloads;
export const EVENT_TYPES = Object.keys(eventPayloads) as EventType[];
export type EventPayload<T extends EventType> = z.infer<(typeof eventPayloads)[T]>;

export const eventEnvelopeSchema = z.object({
  id: z.string().regex(/^e_[0-9A-Z]{26}$/),
  type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  at: z.string(), // ISO time the change was committed
  payload: z.record(z.unknown()),
});
export type DomainEvent = z.infer<typeof eventEnvelopeSchema>;
