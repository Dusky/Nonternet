import { z } from 'zod';
import { slugSchema } from './boards';

// File areas (docs/05, M7): categories made by admins; files uploaded by trusted users.
export const FILE_AREA_VISIBILITIES = ['public', 'members'] as const;
export const FILE_UPLOAD_ROLES = ['user', 'trusted', 'admin'] as const;
export const FILE_NAME_MAX = 100;

export const fileAreaCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(2, 'give the area a name').max(60),
  description: z.string().trim().max(500).default(''),
  visibility: z.enum(FILE_AREA_VISIBILITIES).default('public'),
  upload_role: z.enum(FILE_UPLOAD_ROLES).default('trusted'),
});
export const fileAreaUpdateSchema = fileAreaCreateSchema.omit({ slug: true }).partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export const fileUpdateSchema = z.object({
  title: z.string().trim().max(120),
  description: z.string().trim().max(2000),
}).partial().refine((v) => Object.keys(v).length > 0, 'nothing to change');

export interface FileAreaView {
  id: string; slug: string; name: string; description: string;
  visibility: (typeof FILE_AREA_VISIBILITIES)[number]; upload_role: (typeof FILE_UPLOAD_ROLES)[number];
  archived: boolean; file_count: number; last_upload_at: string | null; can_upload: boolean;
}
export interface FileView {
  id: string; area: string; name: string; title: string; description: string; size_bytes: number; sha256: string;
  downloads: number; uploaded_at: string; uploader: { id: string; handle: string } | null;
  hidden: boolean; mine: boolean; download_url: string;
}
export interface FileUsage { used_bytes: number; quota_bytes: number | null; max_file_bytes: number }
