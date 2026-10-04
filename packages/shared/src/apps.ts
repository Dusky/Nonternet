import { z } from 'zod';

// Apps people add to their own desktop (docs/10, docs/15; decided 2026-10-04). An app is a package: a manifest
// and a static bundle, served from the homes origin and run in a sandboxed frame. It reaches nothing except
// through the shell's bridge, and only what its manifest asks for and the person was told about.

export const APP_PERMISSIONS = ['storage', 'profile:read', 'notify'] as const;
export type AppPermission = typeof APP_PERMISSIONS[number];

export const appIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, 'an app id is 2 to 31 lowercase letters, digits or dashes');
export const appVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'a version looks like 1.0.0');

export const appManifestSchema = z.object({
  id: appIdSchema,
  name: z.string().trim().min(1).max(40),
  version: appVersionSchema,
  description: z.string().trim().min(1).max(200),
  // A single 24x24 SVG path, drawn in the theme's colour like the built-in app icons. Paths only, so a manifest
  // can't smuggle markup into the shell.
  icon: z.string().regex(/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]{1,4000}$/, 'the icon is one SVG path'),
  sticker: z.number().int().min(1).max(5).default(1), // which of the theme's five tile colours
  entry: z.string().regex(/^[a-z0-9_./-]+\.html$/).default('index.html'),
  permissions: z.array(z.enum(APP_PERMISSIONS)).max(APP_PERMISSIONS.length).default([]),
});
export type AppManifest = z.infer<typeof appManifestSchema>;

// What the site offers, as the shell sees it.
export interface CatalogApp {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  sticker: number;
  permissions: AppPermission[];
  url: string;           // where the app's page is, on the homes origin
  installed: boolean;
  offered: boolean;      // false only in the admin view, for apps an admin has withdrawn
  has_data?: boolean;    // the person has something kept for this app, installed or not
}

// What an app may keep for a person (docs/12: it is in their export).
export const APP_DOC_MAX_BYTES = 64 * 1024;
export const APP_DATA_MAX_BYTES = 5 * 1024 * 1024;
export const appCollectionSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
export const appDocIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export interface AppDoc { id: string; data: unknown; updated_at: string }
