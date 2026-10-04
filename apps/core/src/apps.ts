import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  APP_DATA_MAX_BYTES, APP_DOC_MAX_BYTES, appCollectionSchema, appDocIdSchema, appManifestSchema, type AppDoc, type AppManifest, type AppPermission, type CatalogApp,
} from '@app/shared';
import type { SessionUser } from './accounts';
import { audit } from './audit';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';

// Apps people add to their own desktop (docs/10, docs/15). The packages live in a folder (APPS_DIR), one
// sub-folder per app holding manifest.json and the built files; the homes server serves them. This module
// keeps the catalog in step with that folder, records who added what, and is the only way an app's data
// is read or written: the shell's bridge calls these routes, never the database.

// Reads the packages in the apps folder. A folder with a bad manifest is skipped with a warning, so one broken
// package can't stop the site from starting.
export async function readPackages(dir: string | undefined, log: (m: string) => void = () => undefined): Promise<AppManifest[]> {
  if (!dir) return [];
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: AppManifest[] = [];
  for (const name of names.sort()) {
    const raw = await fs.readFile(join(dir, name, 'manifest.json'), 'utf8').catch(() => null);
    if (raw === null) continue;
    let parsed;
    try { parsed = appManifestSchema.safeParse(JSON.parse(raw)); } catch { parsed = null; }
    if (!parsed?.success) { log(`apps: ${name}/manifest.json is not valid; skipped`); continue; }
    if (parsed.data.id !== name) { log(`apps: ${name}/manifest.json says its id is ${parsed.data.id}; skipped`); continue; }
    out.push(parsed.data);
  }
  return out;
}

// At start: new packages join the catalog (offered, until an admin withdraws them), changed ones are updated,
// and ones that have gone are marked absent rather than deleted, so people's data and choices stay put.
export async function syncCatalog(deps: AppDeps, log: (m: string) => void = () => undefined): Promise<void> {
  const found = await readPackages(deps.appsDir, log);
  await deps.db.tx(async (q) => {
    for (const m of found) {
      await q.query(
        `INSERT INTO app_catalog (app_id, version, manifest) VALUES ($1, $2, $3)
         ON CONFLICT (app_id) DO UPDATE SET version = EXCLUDED.version, manifest = EXCLUDED.manifest, present = true, updated_at = now()
         WHERE app_catalog.version IS DISTINCT FROM EXCLUDED.version OR app_catalog.manifest IS DISTINCT FROM EXCLUDED.manifest OR NOT app_catalog.present`,
        [m.id, m.version, JSON.stringify(m)]);
    }
    await q.query(`UPDATE app_catalog SET present = false, updated_at = now() WHERE present AND NOT (app_id = ANY($1))`, [found.map((m) => m.id)]);
  });
}

interface Row { app_id: string; version: string; manifest: AppManifest; offered: boolean; present: boolean }

const view = (deps: AppDeps, r: Row, installed: boolean, hasData?: boolean): CatalogApp => ({
  id: r.app_id, name: r.manifest.name, version: r.version, description: r.manifest.description, icon: r.manifest.icon,
  sticker: r.manifest.sticker, permissions: r.manifest.permissions,
  url: deps.appsUrl(`${r.app_id}@${r.version}/${r.manifest.entry}`), installed, offered: r.offered,
  ...(hasData === undefined ? {} : { has_data: hasData }),
});

// What the site offers this person, with what they have added and what they have data for.
export async function listCatalog(deps: AppDeps, v: SessionUser): Promise<CatalogApp[]> {
  const r = await deps.db.query<Row & { installed: boolean; has_data: boolean }>(
    `SELECT c.app_id, c.version, c.manifest, c.offered, c.present,
            EXISTS (SELECT 1 FROM app_installs i WHERE i.user_id = $1 AND i.app_id = c.app_id) AS installed,
            EXISTS (SELECT 1 FROM app_data d WHERE d.user_id = $1 AND d.app_id = c.app_id) AS has_data
     FROM app_catalog c WHERE c.offered AND c.present ORDER BY c.manifest->>'name'`, [v.userId]);
  return r.rows.map((x) => view(deps, x, x.installed, x.has_data));
}

// The apps this person has added that are still offered: what the shell puts on their desktop.
export async function listInstalled(deps: AppDeps, v: SessionUser): Promise<CatalogApp[]> {
  const r = await deps.db.query<Row>(
    `SELECT c.app_id, c.version, c.manifest, c.offered, c.present FROM app_installs i JOIN app_catalog c ON c.app_id = i.app_id
     WHERE i.user_id = $1 AND c.offered AND c.present ORDER BY i.installed_at`, [v.userId]);
  return r.rows.map((x) => view(deps, x, true));
}

async function offered(q: Queryable, appId: string): Promise<Row> {
  const r = await q.query<Row>(`SELECT app_id, version, manifest, offered, present FROM app_catalog WHERE app_id = $1`, [appId]);
  const row = r.rows[0];
  if (!row || !row.offered || !row.present) throw new ApiError(404, 'not_found', 'That app is not offered here.');
  return row;
}

export async function installApp(deps: AppDeps, v: SessionUser, appId: string): Promise<CatalogApp> {
  const row = await offered(deps.db, appId);
  await deps.db.query(`INSERT INTO app_installs (user_id, app_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [v.userId, appId]);
  return view(deps, row, true);
}

// Removing an app keeps what it kept: adding it again brings it back. Deleting the data is its own choice.
export async function removeApp(deps: AppDeps, v: SessionUser, appId: string): Promise<void> {
  await deps.db.query(`DELETE FROM app_installs WHERE user_id = $1 AND app_id = $2`, [v.userId, appId]);
}

export async function deleteAppData(deps: AppDeps, v: SessionUser, appId: string): Promise<{ deleted: number }> {
  const r = await deps.db.query(`DELETE FROM app_data WHERE user_id = $1 AND app_id = $2`, [v.userId, appId]);
  return { deleted: r.rowCount };
}

// The bridge's storage calls. An app reads and writes only its own data, only while the person has it added,
// only while the site offers it, and only if its manifest asked for storage.
async function usable(q: Queryable, v: SessionUser, appId: string, need: AppPermission): Promise<void> {
  const row = await offered(q, appId);
  const r = await q.query(`SELECT 1 FROM app_installs WHERE user_id = $1 AND app_id = $2`, [v.userId, appId]);
  if (!r.rowCount) throw new ApiError(403, 'not_installed', 'Add this app first.');
  if (!row.manifest.permissions.includes(need)) throw new ApiError(403, 'not_permitted', 'This app did not ask to keep anything.');
}

export async function listDocs(deps: AppDeps, v: SessionUser, appId: string, collection: string): Promise<AppDoc[]> {
  await usable(deps.db, v, appId, 'storage');
  const r = await deps.db.query<{ doc_id: string; data: unknown; updated_at: Date }>(
    `SELECT doc_id, data, updated_at FROM app_data WHERE user_id = $1 AND app_id = $2 AND collection = $3 ORDER BY doc_id LIMIT 2000`,
    [v.userId, appId, collection]);
  return r.rows.map((d) => ({ id: d.doc_id, data: d.data, updated_at: d.updated_at.toISOString() }));
}

export async function putDoc(deps: AppDeps, v: SessionUser, appId: string, collection: string, docId: string, data: unknown): Promise<AppDoc> {
  return deps.db.tx(async (q) => {
    await usable(q, v, appId, 'storage');
    return writeDoc(q, v.userId, appId, collection, docId, data);
  });
}

// The write itself, with the size limits. Inside a transaction.
async function writeDoc(q: Queryable, userId: string, appId: string, collection: string, docId: string, data: unknown): Promise<AppDoc> {
  if (data === undefined) throw new ApiError(400, 'invalid', 'There is nothing to keep.');
  const json = JSON.stringify(data);
  const bytes = Buffer.byteLength(json);
  if (bytes > APP_DOC_MAX_BYTES) throw new ApiError(413, 'too_large', 'That is too big for an app to keep in one piece.');
  // One person's writes to one app happen one at a time, so the total can't be raced past the limit.
  await q.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`app:${userId}:${appId}`]);
  const used = await q.query<{ total: string | null }>(
    `SELECT sum(bytes) AS total FROM app_data WHERE user_id = $1 AND app_id = $2 AND NOT (collection = $3 AND doc_id = $4)`,
    [userId, appId, collection, docId]);
  if (Number(used.rows[0]?.total ?? 0) + bytes > APP_DATA_MAX_BYTES) throw new ApiError(413, 'too_large', 'This app has used all the space it can keep for you.');
  const r = await q.query<{ updated_at: Date }>(
    `INSERT INTO app_data (user_id, app_id, collection, doc_id, data, bytes) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, app_id, collection, doc_id) DO UPDATE SET data = EXCLUDED.data, bytes = EXCLUDED.bytes, updated_at = now()
     RETURNING updated_at`, [userId, appId, collection, docId, json, bytes]);
  return { id: docId, data, updated_at: r.rows[0]!.updated_at.toISOString() };
}

export async function deleteDoc(deps: AppDeps, v: SessionUser, appId: string, collection: string, docId: string): Promise<void> {
  await usable(deps.db, v, appId, 'storage');
  await deps.db.query(`DELETE FROM app_data WHERE user_id = $1 AND app_id = $2 AND collection = $3 AND doc_id = $4`, [v.userId, appId, collection, docId]);
}

// ---------------------------------------------------------------- admin console

export interface AdminApp extends CatalogApp { present: boolean; people: number }

export async function adminListApps(deps: AppDeps): Promise<AdminApp[]> {
  const r = await deps.db.query<Row & { people: string }>(
    `SELECT c.app_id, c.version, c.manifest, c.offered, c.present, (SELECT count(*) FROM app_installs i WHERE i.app_id = c.app_id) AS people
     FROM app_catalog c ORDER BY c.manifest->>'name'`);
  return r.rows.map((x) => ({ ...view(deps, x, false), present: x.present, people: Number(x.people) }));
}

// Offering or withdrawing an app is a site decision, so it is audited (docs/03). Withdrawing hides the app from
// everyone; what people kept stays theirs and stays in their export.
export async function setOffered(deps: AppDeps, v: SessionUser, appId: string, offer: boolean, ipHash: string | null): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ offered: boolean }>(`SELECT offered FROM app_catalog WHERE app_id = $1 FOR UPDATE`, [appId]);
    if (!r.rows[0]) throw new ApiError(404, 'not_found', 'There is no app with that id.');
    if (r.rows[0].offered === offer) return;
    await q.query(`UPDATE app_catalog SET offered = $2, updated_at = now() WHERE app_id = $1`, [appId, offer]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: offer ? 'app.offered' : 'app.withdrawn', targetType: 'app', targetId: appId, origin: 'console', ipHash });
  });
}

// ---------------------------------------------------------------- export and import (docs/12)

// Everything every app kept for a person, by app and collection, whether or not the app is still added or offered.
export async function exportAppData(q: Queryable, userId: string): Promise<{ installed: string[]; data: Map<string, Map<string, { id: string; data: unknown; updated_at: string }[]>> }> {
  const inst = await q.query<{ app_id: string }>(`SELECT app_id FROM app_installs WHERE user_id = $1 ORDER BY installed_at`, [userId]);
  const r = await q.query<{ app_id: string; collection: string; doc_id: string; data: unknown; updated_at: Date }>(
    `SELECT app_id, collection, doc_id, data, updated_at FROM app_data WHERE user_id = $1 ORDER BY app_id, collection, doc_id`, [userId]);
  const data = new Map<string, Map<string, { id: string; data: unknown; updated_at: string }[]>>();
  for (const d of r.rows) {
    const app = data.get(d.app_id) ?? new Map();
    data.set(d.app_id, app);
    const col = app.get(d.collection) ?? [];
    app.set(d.collection, col);
    col.push({ id: d.doc_id, data: d.data, updated_at: d.updated_at.toISOString() });
  }
  return { installed: inst.rows.map((x) => x.app_id), data };
}

// Bringing an export back (docs/12): data for apps this site has, and the apps the person had added, if still
// offered. Data for an app this site doesn't have is left in the archive (it has nowhere to go).
export async function importAppData(deps: AppDeps, v: SessionUser, installed: string[], data: { app: string; collection: string; id: string; data: unknown }[]): Promise<{ restored: number; codes: string[] }> {
  const codes: string[] = [];
  let restored = 0;
  const known = new Map((await deps.db.query<{ app_id: string; offered: boolean }>(`SELECT app_id, offered FROM app_catalog WHERE present`)).rows.map((r) => [r.app_id, r.offered]));
  for (const appId of installed) {
    if (known.get(appId)) await deps.db.query(`INSERT INTO app_installs (user_id, app_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [v.userId, appId]);
    else codes.push('app_missing');
  }
  for (const d of data) {
    if (!known.has(d.app) || !appCollectionSchema.safeParse(d.collection).success || !appDocIdSchema.safeParse(d.id).success) { codes.push('app_missing'); continue; }
    try { await deps.db.tx((q) => writeDoc(q, v.userId, d.app, d.collection, d.id, d.data)); restored += 1; } catch (e) { codes.push(e instanceof ApiError ? e.code : 'failed'); }
  }
  return { restored, codes };
}
