import { z } from 'zod';
import { WIKI_BODY_MAX, WIKI_SUMMARY_MAX, WIKI_TITLE_MAX } from './wikitext';

// The wiki's API shapes (docs/20). `wiki` names which one: "site", or "ring:{slug}".
export const wikiRefSchema = z.string().regex(/^(site|ring:[a-z0-9][a-z0-9-]{1,30})$/, 'no such wiki');

export const wikiSaveSchema = z.object({
  title: z.string().trim().min(1, 'give the page a title').max(WIKI_TITLE_MAX, `keep the title to ${WIKI_TITLE_MAX} characters`),
  body: z.string().max(WIKI_BODY_MAX * 2), // checked properly (after cleaning) by the server
  // The revision the edit started from; 0 to create a new page.
  base_revision: z.number().int().min(0),
  summary: z.string().trim().max(WIKI_SUMMARY_MAX, `keep the summary to ${WIKI_SUMMARY_MAX} characters`).default(''),
});
export const wikiRenameSchema = z.object({ title: wikiSaveSchema.shape.title, base_revision: z.number().int().min(1) });
export const wikiReasonSchema = z.object({ reason: z.string().trim().min(3, 'say why, briefly').max(500) });
export const wikiRevertSchema = z.object({ revision: z.number().int().min(1), base_revision: z.number().int().min(1) });

export interface WikiPerson { id: string; handle: string }
export interface WikiInfo {
  ref: string; scope: 'site' | 'ring'; enabled: boolean;
  ring: { slug: string; name: string } | null;
  can_edit: boolean; can_moderate: boolean;
}
export interface WikiPageView {
  id: string; slug: string; title: string; body: string; revision: number; protected: boolean;
  created_at: string; updated_at: string; updated_by: WikiPerson | null;
  hidden: boolean; deleted: boolean;
  can_edit: boolean;
  redirected_from: string | null; // the slug that was asked for, when it is an old name of this page
  links: { slug: string; title: string; exists: boolean }[];
}
export interface WikiRevisionView {
  id: string; revision: number; title: string; body: string | null; // null when the text is hidden
  summary: string; editor: WikiPerson | null; created_at: string; reverted_to: number | null; text_hidden: boolean;
}
export interface WikiChange { page: { slug: string; title: string }; revision: number; summary: string; editor: WikiPerson | null; created_at: string; reverted_to: number | null; created: boolean }
export interface WikiPageSummary { slug: string; title: string; updated_at: string; revision: number }
export interface WikiSearchHit { slug: string; title: string; snippet: string }
