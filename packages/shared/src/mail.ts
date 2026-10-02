import { z } from 'zod';

// Private mail (docs/10): conversations between two people or small groups, on this site only.
export const MAIL_MAX_PEOPLE = 10;
export const MAIL_SUBJECT_MAX = 120;
export const MAIL_BODY_MAX = 10_000;

const handle = z.string().trim().min(1).max(40);
export const mailBodySchema = z.string().trim().min(1, 'write something').max(MAIL_BODY_MAX);
export const mailStartSchema = z.object({
  to: z.array(handle).min(1, 'add at least one person').max(MAIL_MAX_PEOPLE - 1, `a conversation has at most ${MAIL_MAX_PEOPLE} people`),
  subject: z.string().trim().min(1, 'give it a subject').max(MAIL_SUBJECT_MAX),
  body: mailBodySchema,
});

export interface MailPerson { id: string | null; handle: string | null; display_name: string | null }
export interface MailThreadSummary {
  id: string; subject: string; people: MailPerson[]; last_message_at: string; unread: boolean;
  last: { author: string | null; excerpt: string } | null; left: boolean; muted: boolean;
}
// One page of the inbox: `unread` counts the whole inbox, `next` is the cursor for the page after this one (null at the end).
export interface MailInbox { threads: MailThreadSummary[]; unread: number; next: string | null }
export interface MailMessageView { id: string; kind: 'message' | 'joined' | 'left'; author: MailPerson; body: string; deleted: boolean; at: string; mine: boolean }
export interface MailThreadView { id: string; subject: string; people: MailPerson[]; left: boolean; muted: boolean; messages: MailMessageView[] }
export interface BlockView { handle: string; since: string }
