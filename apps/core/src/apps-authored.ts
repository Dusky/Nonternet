import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import {
  APP_PACKAGE_MAX_BYTES, APP_PACKAGE_MAX_FILES, appManifestSchema, type AppManifest, type AppReviewItem, type AppVersionStatus, type AuthoredApp,
} from '@app/shared';
import type { Ctx, SessionUser } from './accounts';
import { audit } from './audit';
import { newId } from './crypto';
import type { Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { extOf, MIME } from './homes/files';

// Apps made by trusted people (docs/10, 15, 17 2026-10-18; closes Q18). A trusted person sends a zip of the built app with
// its manifest. It is private to them (they can add it and try it) until an admin reviews it; approving offers it to
// everyone. Each new version is reviewed again while the approved one stays live. Review is the safety check on what an
// app says and does; the sandbox it runs in is the same as for the site's own apps (no network, no cookies, only the
// bridge, only what each person allows).

// Where a submitted version's files live: <files>/apps/<id>/<version>/. Backed up with the files folder.
export const submittedDir = (deps: Pick<AppDeps, 'filesDir'>, id: string, version?: string) =>
  version ? join(deps.filesDir, 'apps', id, version) : join(deps.filesDir, 'apps', id);

const bad = (message: string) => new ApiError(400, 'bad_package', message);
const notFound = () => new ApiError(404, 'not_found', 'There is no app with that id.');

export const compareVersions = (a: string, b: string): number => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

// Opens the zip and checks every file: only kinds of file the homes server serves, no hidden or climbing paths, the
// manifest valid, and its entry page (and widget) present. A zip made from the app's folder (one folder at the top) works too.
export function readPackage(zip: Uint8Array): { manifest: AppManifest; files: Map<string, Uint8Array> } {
  if (zip.length === 0) throw bad('Choose the zip file of your app.');
  if (zip.length > APP_PACKAGE_MAX_BYTES) throw new ApiError(413, 'too_large', 'An app can be at most 5 MB.');
  let total = 0;
  let count = 0;
  let tooBig = false;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, { filter: (f) => {
      if (f.name.endsWith('/')) return false;
      count += 1;
      total += f.originalSize;
      if (count > APP_PACKAGE_MAX_FILES || total > APP_PACKAGE_MAX_BYTES) { tooBig = true; return false; }
      return true;
    } });
  } catch { throw bad('That is not a zip file. Zip the folder with your built app and its manifest.json.'); }
  if (tooBig) throw new ApiError(413, 'too_large', `An app can have at most ${APP_PACKAGE_MAX_FILES} files and 5 MB once unpacked.`);
  let names = Object.keys(raw);
  // One folder at the top holding everything: use what is inside it.
  const top = names[0]?.split('/')[0];
  const prefix = top && !raw['manifest.json'] && names.every((n) => n.startsWith(`${top}/`)) ? `${top}/` : '';
  const files = new Map<string, Uint8Array>();
  for (const name of names) {
    const rel = name.slice(prefix.length);
    const segs = rel.split('/');
    if (!rel || rel.includes('\\') || rel.startsWith('/') || segs.some((s) => !s || s.startsWith('.') || s === '..')) {
      throw bad(`${name.slice(0, 120)} has a name an app can't use (no hidden files or folders, no "..").`);
    }
    if (!/^[A-Za-z0-9_./-]+$/.test(rel)) throw bad(`${name.slice(0, 120)}: use letters, digits, dots, dashes and underscores in file names.`);
    if (!MIME[extOf(rel)]) throw bad(`${rel.slice(0, 120)}: .${extOf(rel) || 'no extension'} files can't be part of an app.`);
    files.set(rel, raw[name]!);
  }
  names = [...files.keys()];
  const m = files.get('manifest.json');
  if (!m) throw bad('The zip has no manifest.json at the top.');
  let parsed;
  try { parsed = appManifestSchema.safeParse(JSON.parse(Buffer.from(m).toString('utf8'))); } catch { parsed = null; }
  if (!parsed?.success) {
    const issue = parsed?.error.issues[0];
    throw bad(issue ? `manifest.json: ${issue.path.join('.') || 'the file'} ${issue.message}` : 'manifest.json is not valid JSON.');
  }
  const manifest = parsed.data;
  if (!files.has(manifest.entry)) throw bad(`The manifest's entry page, ${manifest.entry}, is not in the zip.`);
  if (manifest.widget && !files.has(manifest.widget)) throw bad(`The manifest's widget page, ${manifest.widget}, is not in the zip.`);
  return { manifest, files };
}

const mayAuthor = (v: SessionUser) => v.role === 'trusted' || v.role === 'admin';

// Sending a new app, or a new version of one's own. A version still waiting for review is replaced by a newer one.
export async function submitApp(deps: AppDeps, v: SessionUser, zip: Uint8Array, ctx: Ctx): Promise<AuthoredApp> {
  if (!mayAuthor(v)) throw new ApiError(403, 'forbidden', 'Trusted people can send apps.');
  const { manifest, files } = readPackage(zip);
  const id = manifest.id;
  const bytes = [...files.values()].reduce((n, f) => n + f.length, 0);
  const list = [...files.entries()].map(([path, f]) => ({ path, size: f.length })).sort((a, b) => a.path.localeCompare(b.path));
  const replaced: string[] = [];
  await deps.db.tx(async (q) => {
    const cur = await q.query<{ source: string; author_id: string | null }>(`SELECT source, author_id FROM app_catalog WHERE app_id = $1 FOR UPDATE`, [id]);
    const row = cur.rows[0];
    if (row && (row.source !== 'submitted' || row.author_id !== v.userId)) throw new ApiError(409, 'app_id_taken', `The id "${id}" is taken. Change the id in manifest.json.`);
    const versions = (await q.query<{ version: string; status: AppVersionStatus }>(`SELECT version, status FROM app_versions WHERE app_id = $1`, [id])).rows;
    const newest = versions.map((x) => x.version).sort(compareVersions).at(-1);
    if (newest && compareVersions(manifest.version, newest) <= 0) throw new ApiError(409, 'version_not_newer', `Raise the version in manifest.json: it must be newer than ${newest}.`);
    if (!row) {
      await q.query(`INSERT INTO app_catalog (app_id, version, manifest, offered, present, source, author_id) VALUES ($1, $2, $3, false, true, 'submitted', $4)`, [id, manifest.version, JSON.stringify(manifest), v.userId]);
    } else if (!(await q.query(`SELECT 1 FROM app_versions WHERE app_id = $1 AND status = 'approved'`, [id])).rowCount) {
      // Nothing live yet: the catalog shows the newest version sent, still not offered.
      await q.query(`UPDATE app_catalog SET version = $2, manifest = $3, present = true, updated_at = now() WHERE app_id = $1`, [id, manifest.version, JSON.stringify(manifest)]);
    }
    for (const x of versions) if (x.status === 'pending') replaced.push(x.version);
    await q.query(`UPDATE app_versions SET status = 'replaced' WHERE app_id = $1 AND status = 'pending'`, [id]);
    await q.query(`INSERT INTO app_versions (app_id, version, manifest, files, bytes) VALUES ($1, $2, $3, $4, $5)`, [id, manifest.version, JSON.stringify(manifest), JSON.stringify(list), bytes]);
    // Written inside the transaction, so a failure leaves neither files nor a row; a temporary folder keeps it all-or-nothing.
    const dir = submittedDir(deps, id, manifest.version);
    const tmp = `${dir}.${newId('tmp')}`;
    for (const [path, data] of files) {
      await fs.mkdir(join(tmp, path, '..'), { recursive: true });
      await fs.writeFile(join(tmp, path), data);
    }
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(tmp, dir);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'app.submitted', targetType: 'app', targetId: id, after: { version: manifest.version, permissions: manifest.permissions }, origin: 'web', ipHash: ctx.ipHash });
  });
  for (const old of replaced) await fs.rm(submittedDir(deps, id, old), { recursive: true, force: true });
  return (await listAuthored(deps, v)).find((a) => a.id === id)!;
}

export async function listAuthored(deps: AppDeps, v: SessionUser): Promise<AuthoredApp[]> {
  const apps = await deps.db.query<{ app_id: string; manifest: AppManifest; offered: boolean; people: number }>(
    `SELECT c.app_id, c.manifest, c.offered, (SELECT count(*)::int FROM app_installs i WHERE i.app_id = c.app_id) AS people
     FROM app_catalog c WHERE c.source = 'submitted' AND c.author_id = $1 ORDER BY c.manifest->>'name'`, [v.userId]);
  const vers = await deps.db.query<{ app_id: string; version: string; status: AppVersionStatus; submitted_at: Date; reviewed_at: Date | null; reason: string | null; bytes: number }>(
    `SELECT app_id, version, status, submitted_at, reviewed_at, reason, bytes FROM app_versions WHERE app_id = ANY($1) ORDER BY submitted_at DESC`, [apps.rows.map((a) => a.app_id)]);
  return apps.rows.map((a) => {
    const versions = vers.rows.filter((x) => x.app_id === a.app_id).map((x) => ({
      version: x.version, status: x.status, submitted_at: x.submitted_at.toISOString(), reviewed_at: x.reviewed_at?.toISOString() ?? null, reason: x.reason, bytes: x.bytes,
    }));
    return {
      id: a.app_id, name: a.manifest.name, description: a.manifest.description, icon: a.manifest.icon, sticker: a.manifest.sticker,
      offered: a.offered, live_version: versions.find((x) => x.status === 'approved')?.version ?? null, people: a.people, versions,
    };
  });
}

// The author takes their app back: it leaves everyone's desktop, and a version waiting for review is dropped. What
// people kept with it stays theirs and stays in their export, as when an admin withdraws an app.
export async function withdrawAuthored(deps: AppDeps, v: SessionUser, id: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE app_catalog SET offered = false, updated_at = now() WHERE app_id = $1 AND source = 'submitted' AND author_id = $2`, [id, v.userId]);
    if (!r.rowCount) throw notFound();
    await q.query(`UPDATE app_versions SET status = 'withdrawn' WHERE app_id = $1 AND status = 'pending'`, [id]);
    await closeReports(q, id, v.userId, 'app withdrawn by its author');
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'app.withdrawn', targetType: 'app', targetId: id, after: { by: 'author' }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// Account deletion (docs/12): the person's apps are withdrawn; people who added them keep what they kept.
export async function withdrawAllBy(q: Queryable, userId: string): Promise<void> {
  const ids = (await q.query<{ app_id: string }>(`UPDATE app_catalog SET offered = false, updated_at = now() WHERE source = 'submitted' AND author_id = $1 RETURNING app_id`, [userId])).rows.map((r) => r.app_id);
  if (ids.length) await q.query(`UPDATE app_versions SET status = 'withdrawn' WHERE app_id = ANY($1) AND status = 'pending'`, [ids]);
}

export async function closeReports(q: Queryable, appId: string, by: string, note: string): Promise<void> {
  await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = $3 WHERE target_type = 'app' AND target_id = $1 AND status = 'open'`, [appId, by, note]);
}

// ---------------------------------------------------------------- review (admins)

export async function reviewQueue(deps: AppDeps): Promise<AppReviewItem[]> {
  const r = await deps.db.query<{ app_id: string; version: string; manifest: AppManifest; files: { path: string; size: number }[]; bytes: number; submitted_at: Date; author: string | null; live: string | null }>(
    `SELECT v.app_id, v.version, v.manifest, v.files, v.bytes, v.submitted_at, u.handle AS author,
            (SELECT x.version FROM app_versions x WHERE x.app_id = v.app_id AND x.status = 'approved') AS live
     FROM app_versions v JOIN app_catalog c ON c.app_id = v.app_id LEFT JOIN users u ON u.id = c.author_id
     WHERE v.status = 'pending' ORDER BY v.submitted_at`);
  return r.rows.map((x) => ({
    id: x.app_id, version: x.version, name: x.manifest.name, description: x.manifest.description, icon: x.manifest.icon, sticker: x.manifest.sticker,
    permissions: x.manifest.permissions, author: x.author, submitted_at: x.submitted_at.toISOString(), live_version: x.live, files: x.files, bytes: x.bytes,
    url: deps.appsUrl(`${x.app_id}@${x.version}/${x.manifest.entry}`), widget_url: x.manifest.widget ? deps.appsUrl(`${x.app_id}@${x.version}/${x.manifest.widget}`) : null,
  }));
}

// Approving makes this version the live one and offers the app; declining says why, and the author sees the reason.
export async function reviewVersion(deps: AppDeps, admin: SessionUser, id: string, version: string, decision: 'approve' | 'decline', reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ manifest: AppManifest; status: AppVersionStatus }>(`SELECT manifest, status FROM app_versions WHERE app_id = $1 AND version = $2 FOR UPDATE`, [id, version]);
    const row = r.rows[0];
    if (!row) throw notFound();
    if (row.status !== 'pending') throw new ApiError(409, 'no_change', 'That version is not waiting for review.');
    if (decision === 'approve') {
      await q.query(`UPDATE app_versions SET status = 'replaced' WHERE app_id = $1 AND status = 'approved'`, [id]);
      await q.query(`UPDATE app_versions SET status = 'approved', reviewed_by = $3, reviewed_at = now(), reason = $4 WHERE app_id = $1 AND version = $2`, [id, version, admin.userId, reason || null]);
      await q.query(`UPDATE app_catalog SET version = $2, manifest = $3, offered = true, present = true, updated_at = now() WHERE app_id = $1`, [id, version, JSON.stringify(row.manifest)]);
    } else {
      if (reason.trim().length < 3) throw new ApiError(400, 'reason_required', 'Say why, so the author can fix it.');
      await q.query(`UPDATE app_versions SET status = 'declined', reviewed_by = $3, reviewed_at = now(), reason = $4 WHERE app_id = $1 AND version = $2`, [id, version, admin.userId, reason.trim()]);
    }
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: decision === 'approve' ? 'app.approved' : 'app.declined', targetType: 'app', targetId: id, after: { version, reason: reason || undefined }, origin: 'console', ipHash: ctx.ipHash });
  });
  if (decision === 'decline') await fs.rm(submittedDir(deps, id, version), { recursive: true, force: true });
}

// ---------------------------------------------------------------- reports

export async function reportApp(deps: AppDeps, v: SessionUser, id: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  const app = (await deps.db.query<{ author_id: string | null }>(`SELECT author_id FROM app_catalog WHERE app_id = $1 AND offered AND present`, [id])).rows[0];
  if (!app) throw notFound();
  if (app.author_id === v.userId) throw new ApiError(409, 'own_app', 'That app is yours.');
  const rid = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, 'app', $2, 'site', 'site', $3, $4, $5)`, [rid, id, v.userId, category, note]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.created', targetType: 'app', targetId: id, after: { category }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'reports_one_open') throw new ApiError(409, 'already_reported', 'You already reported this. The admins have it.');
    throw err;
  }
  return { id: rid };
}

// ---------------------------------------------------------------- export (docs/12)

// The author's apps, every version they sent that is still kept: its manifest, review state and files.
export async function exportAuthored(deps: AppDeps, userId: string, add: (path: string, data: string | Buffer) => void): Promise<void> {
  const r = await deps.db.query<{ app_id: string; version: string; status: string; submitted_at: Date; reason: string | null; files: { path: string }[] }>(
    `SELECT v.app_id, v.version, v.status, v.submitted_at, v.reason, v.files FROM app_versions v JOIN app_catalog c ON c.app_id = v.app_id
     WHERE c.source = 'submitted' AND c.author_id = $1 ORDER BY v.app_id, v.submitted_at`, [userId]);
  if (!r.rows.length) return;
  add('apps-authored/versions.json', `${JSON.stringify(r.rows.map((x) => ({ app: x.app_id, version: x.version, status: x.status, sent: x.submitted_at.toISOString(), reason: x.reason })), null, 2)}\n`);
  for (const x of r.rows) {
    for (const f of x.files) {
      try { add(`apps-authored/${x.app_id}/${x.version}/${f.path}`, await fs.readFile(join(submittedDir(deps, x.app_id, x.version), f.path))); } catch { /* a declined or replaced version's files are not kept */ }
    }
  }
}
