import { z } from 'zod';

// Homepages (docs/07).
export const homepageSettingsSchema = z.object({
  title: z.string().trim().max(100),
  description: z.string().trim().max(300),
  guestbook_mode: z.enum(['open', 'approval', 'off']),
}).partial().refine((v) => Object.keys(v).length > 0, 'nothing to change');

export const homeFolderSchema = z.object({ path: z.string().max(200) });
export const homeMoveSchema = z.object({ from: z.string().max(200), to: z.string().max(200) });
export const homeTemplateSchema = z.object({ template: z.string().max(40), replace: z.boolean().default(false) });

// Text the studio can open in its editor; anything else is uploaded.
export const HOME_EDITABLE_EXTENSIONS = ['html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'md', 'xml', 'svg'] as const;

export interface HomeFileEntry { path: string; type: 'file' | 'dir'; size: number; modified: string; editable: boolean }
export interface HomepageSummary {
  title: string; description: string; url: string; has_index: boolean;
  guestbook_mode: 'open' | 'approval' | 'off'; size_bytes: number; quota_bytes: number; file_max_bytes: number; file_count: number; last_updated_at: string | null; hidden: boolean;
}
export interface HomeTemplateInfo { id: string; title: string; description: string }
