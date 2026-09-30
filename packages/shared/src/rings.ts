import { z } from 'zod';
import { slugSchema } from './boards';

// Rings (docs/06).
export const JOIN_POLICIES = ['open', 'approval', 'invite'] as const;
export type JoinPolicy = (typeof JOIN_POLICIES)[number];
export const MAX_RING_MEMBERSHIPS = 20;   // a soft cap against spam (docs/06, PROPOSED)

const tag = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,19}$/, 'tags use 2 to 20 lowercase letters, digits and hyphens');
const tags = z.array(tag).max(5).transform((a) => [...new Set(a)]);

// A ring's address is also the name of its board (ring-{slug}), so it is a little shorter than a board's.
const ringSlug = slugSchema.refine((s) => s.length <= 24, 'a ring address can be up to 24 characters');

export const ringCreateSchema = z.object({
  slug: ringSlug,
  name: z.string().trim().min(2, 'give the ring a name').max(60),
  description: z.string().trim().max(300).default(''),
  about: z.string().trim().max(5000).default(''),
  tags: tags.default([]),
  join_policy: z.enum(JOIN_POLICIES).default('open'),
});
export const ringUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300),
  about: z.string().trim().max(5000),
  tags,
  join_policy: z.enum(JOIN_POLICIES),
  archived: z.boolean(),
}).partial().refine((v) => Object.keys(v).length > 0, 'nothing to change');
export const ringOrderSchema = z.object({ user_ids: z.array(z.string().regex(/^u_[0-9A-Z]{26}$/)).min(1).max(500) });
export const ringHandleSchema = z.object({ handle: z.string().trim().min(1).max(40), reason: z.string().trim().max(500).optional() });
export const ringMemberActionSchema = z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(500).optional() });

export type MemberStatus = 'pending' | 'invited' | 'member' | 'banned';

export interface RingSummary {
  id: string; slug: string; name: string; description: string; tags: string[]; join_policy: JoinPolicy;
  founder: { id: string; handle: string }; board: { slug: string } | null; member_count: number; archived: boolean; hidden: boolean;
  created_at: string; recent_activity: number;
  // About the viewer.
  me: { status: MemberStatus | null; is_op: boolean; is_founder: boolean } | null;
}
export interface RingDetail extends RingSummary { about: string; ops: { op_id: string; id: string; handle: string }[]; latest_posts: { id: string; thread_id: string; subject: string; author: string | null; at: string }[] }
export interface RingMemberView {
  user_id: string; handle: string; display_name: string | null; status: MemberStatus; joined_at: string; homepage_url: string | null;
  // For ops only: why a page may not be working as part of the ring.
  flags?: ('no_homepage' | 'no_nav_bar')[];
}
export interface RingNav { ring: { slug: string; name: string; url: string }; member: boolean; prev: string; next: string; random: string; list: string }
