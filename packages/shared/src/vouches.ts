import { z } from 'zod';

// Vouching (docs/03): trusted people vouch for a user; an admin confirms.
export const vouchCreateSchema = z.object({
  handle: z.string().trim().min(1).max(40),
  note: z.string().trim().max(500).default(''),
});

export interface MyVouch { handle: string; note: string; at: string }

export interface AdminVouchCandidate {
  user: { id: string; handle: string; joined_at: string };
  // `counts` is false once the voucher is no longer trusted or active; `flags` are earlier people they
  // vouched for who were demoted or suspended soon after.
  vouches: { id: string; voucher: { id: string; handle: string; flags: number }; note: string; at: string; counts: boolean }[];
  ready: boolean;
  hints: { age_days: number; posts: number; recent_mod_actions: number; old_enough: boolean; enough_posts: boolean; clean: boolean };
}
