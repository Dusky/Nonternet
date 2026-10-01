import { z } from 'zod';

// BBS classics (M9-E): oneliners, bulletins and the voting booth. Shared by core, the web shell and the BBS.
export const ONELINER_MAX = 60;
export const ONELINER_GAP_MINUTES = 60;
export const onelinerSchema = z.object({
  body: z.string().trim().min(1).max(ONELINER_MAX).regex(/^[^\p{C}]*$/u, 'no line breaks or control characters'),
});
export interface OnelinerView { id: string; author: { id: string; handle: string } | null; body: string; at: string; mine: boolean }

export const BULLETIN_TITLE_MAX = 80;
export const BULLETIN_BODY_MAX = 4000;
export const bulletinSchema = z.object({
  title: z.string().trim().min(1).max(BULLETIN_TITLE_MAX).regex(/^[^\p{C}]*$/u, 'no line breaks or control characters'),
  body: z.string().trim().min(1).max(BULLETIN_BODY_MAX),
});
export interface BulletinSummary { id: string; number: number; title: string; at: string; unread: boolean }
export interface BulletinView extends BulletinSummary { body: string; updated_at: string | null }

export const POLL_QUESTION_MAX = 140;
export const POLL_OPTION_MAX = 60;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 8;
export const pollSchema = z.object({
  question: z.string().trim().min(3).max(POLL_QUESTION_MAX).regex(/^[^\p{C}]*$/u, 'no line breaks or control characters'),
  options: z.array(z.string().trim().min(1).max(POLL_OPTION_MAX).regex(/^[^\p{C}]*$/u, 'no line breaks or control characters')).min(POLL_OPTIONS_MIN).max(POLL_OPTIONS_MAX)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'each choice must be different'),
  closes_in_days: z.number().int().min(1).max(90).optional(),
});
export interface PollSummary { id: string; question: string; closes_at: string | null; closed: boolean; voted: boolean; by: string | null }
// Counts are present only once the viewer has voted or the poll has closed (so nobody votes with the tally in front of them).
export interface PollView extends PollSummary { options: { id: string; label: string; votes: number | null }[]; my_vote: string | null; total: number | null; can_see_results: boolean }
