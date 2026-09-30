import { z } from 'zod';

// Ops are moderators scoped to one thing (docs/03). Carried in the token's `ops` claim as
// "board:b_…", "ring:r_…", "channel:#name", "mud:world" (docs/02). A MUD op is a builder (docs/09, 18).
export const OP_SCOPES = ['board', 'ring', 'channel', 'mud'] as const;
export type OpScope = (typeof OP_SCOPES)[number];

// The stored role name for each scope.
export const OP_ROLE: Record<OpScope, 'board_op' | 'ring_op' | 'channel_op' | 'mud_builder'> = {
  board: 'board_op',
  ring: 'ring_op',
  channel: 'channel_op',
  mud: 'mud_builder',
};

// Until boards and rings exist (M2, M3) we can only check the shape of an ID, not that it exists.
export const SCOPE_ID_PATTERN: Record<OpScope, RegExp> = {
  board: /^b_[0-9A-Z]{26}$/,
  ring: /^r_[0-9A-Z]{26}$/,
  channel: /^#[a-z0-9][a-z0-9_-]{0,49}$/,
  mud: /^world$/, // one shared world (D9)
};

export const grantOpSchema = z
  .object({ scope: z.enum(OP_SCOPES), scope_id: z.string().max(80), reason: z.string().trim().max(500).optional() })
  .superRefine((v, ctx) => {
    if (!SCOPE_ID_PATTERN[v.scope].test(v.scope_id)) {
      ctx.addIssue({ code: 'custom', path: ['scope_id'], message: `not a valid ${v.scope} ID` });
    }
  });

export const opClaim = (scope: OpScope, scopeId: string): string => `${scope}:${scopeId}`;

// Console stats (docs/11 §9). Days and hours are UTC.
export interface AdminStats {
  days: { day: string; dau: number; wau: number; mau: number; signups: number; posts: number }[];
  // active[i] = people from that signup week who were active i weeks later (0 = the signup week).
  cohorts: { week: string; size: number; active: number[] }[];
  heatmap: number[][];   // 7 weekdays (Monday first) × 24 hours: posts
  totals: { users: number; posts: number; homepages: number; rings: number; files: number; mail_messages: number };
  range: { days: number; weeks: number; until: string };
}

// The command console (docs/11 §11).
export interface ConsoleCommandSpec { name: string; usage: string; summary: string; args: string[] }
export interface ConsoleResult { lines: string[]; table?: { columns: string[]; rows: string[][] } }
