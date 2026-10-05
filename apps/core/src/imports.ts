import { createHash, createPublicKey, verify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { CLIENT_NAMES, PREF_KINDS, homepageSettingsSchema, profileUpdateSchema, wallpaperUpdateSchema } from '@app/shared';
import { putClientSettings } from './client-settings';
import { importAppData } from './apps';
import { audit } from './audit';
import { newId } from './crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { verifyPassword } from './passwords';
import type { Ctx, SessionUser } from './accounts';
import { isMember } from './boards';
import * as accounts from './accounts';
import * as personal from './personal';
import * as wallpaper from './wallpaper';
import * as homes from './homes/service';
import * as files from './files';
import { addKey } from './bbs/service';
import { cleanPath } from './homes/files';

// Bringing back an export (docs/12). Only what is yours alone comes back: your profile and settings, your
// avatar, your homepage, your files and your SSH keys. Posts, mail, guestbooks, rings and the rest involve
// other people or the site's own records, so they stay in the archive and the preview says why.

export const IMPORT_PARTS = ['profile', 'settings', 'avatar', 'homepage', 'files', 'keys', 'clients', 'apps'] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];
const SKIPPED = [
  ['posts', 'posts/posts.json'], ['mail', 'mail/conversations.json'], ['guestbook', 'guestbook.json'], ['rings', 'rings/'], ['boards', 'boards/'],
  ['chat', 'irc/messages.json'], ['mud', 'mud/characters.json'], ['vouches', 'vouches.json'], ['classics', 'classics.json'],
] as const;

export interface Issue { code: string; count: number }
export interface PartPlan { part: ImportPart; count: number; issues: Issue[] }
export interface ImportPreview {
  id: string; origin: 'this_site' | 'other_site'; site: { name: string; domain: string }; handle: string; generated_at: string;
  parts: PartPlan[]; skipped: { kind: string; count: number }[];
}
export interface ImportResult { parts: { part: ImportPart; restored: number; issues: Issue[] }[] }

const MAX_ENTRIES = 5000;
const LIFETIME_MS = 3_600_000;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const dir = (deps: AppDeps) => join(deps.exportsDir, 'imports');
export const importMaxBytes = (deps: AppDeps) => Math.floor(deps.config.limits.import_max_mb * 1048576);
const bad = (msg: string) => new ApiError(400, 'bad_archive', msg);

interface Manifest { format: string; generated_at: string; site: { name: string; domain: string }; user: { id: string; handle: string }; files: { path: string; size: number; sha256: string }[] }
interface Archive { manifest: Manifest; files: Map<string, Buffer>; signed: boolean }

// Opens an export and checks it: every file the manifest lists is there with the right size and hash,
// nothing else is, and the whole thing unpacks to no more than the upload limit allows.
export function readArchive(zip: Uint8Array, maxBytes: number): Archive {
  let total = 0;
  let count = 0;
  let tooBig = false;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, { filter: (f) => {
      count += 1;
      total += f.originalSize;
      if (count > MAX_ENTRIES || total > maxBytes) { tooBig = true; return false; }
      return !f.name.endsWith('/');
    } });
  } catch { throw bad('That is not an export archive (it should be the zip file from Your data).'); }
  if (tooBig) throw new ApiError(413, 'too_large', 'That archive unpacks to more than an export can hold here.');
  const manifestRaw = raw['manifest.json'];
  if (!manifestRaw) throw bad('That zip has no manifest.json, so it is not an export from this kind of site.');
  let manifest: Manifest;
  try { manifest = JSON.parse(Buffer.from(manifestRaw).toString('utf8')) as Manifest; } catch { throw bad('The manifest in that archive is damaged.'); }
  if (manifest.format !== 'export-v1' || !Array.isArray(manifest.files) || !manifest.user?.id || !manifest.site?.domain) throw bad('That archive is in a format this site does not know.');
  const out = new Map<string, Buffer>();
  for (const f of manifest.files) {
    const data = raw[f.path];
    if (!data) throw bad(`The archive is missing ${String(f.path).slice(0, 200)}, which its manifest lists.`);
    if (data.length !== f.size || sha(data) !== f.sha256) throw bad(`${String(f.path).slice(0, 200)} has changed since the export was made.`);
    out.set(f.path, Buffer.from(data));
  }
  for (const name of Object.keys(raw)) {
    if (name !== 'manifest.json' && name !== 'manifest.sig' && !out.has(name)) throw bad(`The archive has a file its manifest does not list (${name.slice(0, 200)}).`);
  }
  const pub = out.get('keys/public.key');
  const sig = raw['manifest.sig'];
  return { manifest, files: out, signed: Boolean(pub && sig && checkSig(pub.toString('utf8'), Buffer.from(manifestRaw), Buffer.from(sig))) };
}

function checkSig(pem: string, manifest: Buffer, sigB64: Buffer): boolean {
  try { return verify(null, manifest, createPublicKey(pem), Buffer.from(sigB64.toString('utf8').trim(), 'base64')); } catch { return false; }
}

const json = <T>(a: Archive, path: string): T | null => {
  const b = a.files.get(path);
  if (!b) return null;
  try { return JSON.parse(b.toString('utf8')) as T; } catch { throw bad(`${path} in that archive is damaged.`); }
};
interface FileMeta { area: string; name: string; title: string; description: string }
const homepageFiles = (a: Archive) => [...a.files.keys()].filter((p) => p.startsWith('homepage/')).map((p) => p.slice('homepage/'.length));
const keyLines = (a: Archive) => (a.files.get('keys/ssh_authorized_keys')?.toString('utf8') ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const tally = (codes: string[]): Issue[] => Object.entries(codes.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {})).map(([code, count]) => ({ code, count }));

// Where an archive came from. One made here for you is proven by your own key; one made elsewhere can only be
// checked for changes, so the preview says so. An archive made here for someone else is refused.
async function originOf(deps: AppDeps, v: SessionUser, a: Archive): Promise<'this_site' | 'other_site'> {
  if (a.manifest.site.domain !== deps.config.site.domain) {
    if (!a.signed) throw bad('The signature on that archive does not match its contents.');
    return 'other_site';
  }
  if (a.manifest.user.id !== v.userId) throw new ApiError(403, 'not_yours', 'That export was made for a different account on this site.');
  const r = await deps.db.query<{ public_key: string | null }>(`SELECT public_key FROM users WHERE id = $1`, [v.userId]);
  const mine = r.rows[0]?.public_key;
  const sig = a.files.get('keys/public.key');
  if (!mine || !sig || sig.toString('utf8').trim() !== mine.trim() || !a.signed) throw bad('That archive was not signed by this site for you.');
  return 'this_site';
}

async function plan(deps: AppDeps, v: SessionUser, a: Archive): Promise<{ parts: PartPlan[]; skipped: { kind: string; count: number }[] }> {
  const parts: PartPlan[] = [];
  if (a.files.has('profile.json')) parts.push({ part: 'profile', count: 1, issues: [] });
  if (a.files.has('settings.json')) parts.push({ part: 'settings', count: 1, issues: [] });
  if (a.files.has('avatar.webp')) parts.push({ part: 'avatar', count: 1, issues: [] });
  const hp = homepageFiles(a);
  if (hp.length || a.files.has('homepage.json')) {
    const existing = new Set((await deps.homes.tree(v.userId)).filter((e) => e.type === 'file').map((e) => e.path));
    parts.push({ part: 'homepage', count: hp.length, issues: tally(hp.filter((p) => existing.has(p)).map(() => 'exists')) });
  }
  const meta = json<FileMeta[]>(a, 'files.json') ?? [];
  if (meta.length) {
    const codes: string[] = [];
    for (const f of meta) {
      const area = await deps.db.query<{ id: string }>(`SELECT id FROM file_areas WHERE slug = $1 AND archived_at IS NULL`, [f.area]);
      if (!area.rows[0]) { codes.push('area_missing'); continue; }
      const taken = await deps.db.query(`SELECT 1 FROM files WHERE area_id = $1 AND name = $2 AND deleted_at IS NULL`, [area.rows[0].id, f.name]);
      if (taken.rowCount) codes.push('name_taken');
    }
    parts.push({ part: 'files', count: meta.length, issues: tally(codes) });
  }
  const keys = keyLines(a);
  if (keys.length) parts.push({ part: 'keys', count: keys.length, issues: [] });
  const clientFiles = CLIENT_NAMES.filter((n) => a.files.has(`${n}/client.json`));
  if (clientFiles.length) parts.push({ part: 'clients', count: clientFiles.length, issues: [] });
  const appDocs = appDocsOf(a);
  if (appDocs.length || appInstallsOf(a).length) {
    const known = new Set((await deps.db.query<{ app_id: string }>(`SELECT app_id FROM app_catalog WHERE present`)).rows.map((r) => r.app_id));
    parts.push({ part: 'apps', count: appDocs.length, issues: tally(appDocs.filter((d) => !known.has(d.app)).map(() => 'app_missing')) });
  }
  const skipped: { kind: string; count: number }[] = [];
  for (const [kind, path] of SKIPPED) {
    if (path.endsWith('/')) { const n = [...a.files.keys()].filter((p) => p.startsWith(path)).length; if (n) skipped.push({ kind, count: n }); continue; }
    const data = json<unknown>(a, path);
    if (data === null) continue;
    const n = Array.isArray(data) ? data.length : kind === 'mud' ? ((data as { characters?: unknown[] }).characters?.length ?? 0) : 1;
    if (n) skipped.push({ kind, count: n });
  }
  return { parts, skipped };
}

// Step one: upload. Nothing changes; the archive is checked, kept for an hour, and the preview says what would come back.
export async function previewImport(deps: AppDeps, v: SessionUser, zip: Buffer): Promise<ImportPreview> {
  if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.');
  if (!zip.length) throw bad('Choose the zip file from Your data.');
  const a = readArchive(zip, importMaxBytes(deps));
  const origin = await originOf(deps, v, a);
  const id = newId('im');
  await fs.mkdir(dir(deps), { recursive: true });
  await fs.writeFile(join(dir(deps), `${id}.zip`), zip);
  await deps.db.query(`INSERT INTO imports (id, user_id, sha256) VALUES ($1, $2, $3)`, [id, v.userId, sha(zip)]);
  return { id, origin, site: { name: String(a.manifest.site.name), domain: a.manifest.site.domain }, handle: String(a.manifest.user.handle), generated_at: String(a.manifest.generated_at), ...(await plan(deps, v, a)) };
}

// Step two: bring back the parts the person chose. Each part is done on its own, through the same checks as
// doing it by hand, so a file that doesn't fit is reported and the rest still comes back.
export async function applyImport(deps: AppDeps, v: SessionUser, id: string, input: { password: string; parts: ImportPart[]; replace_homepage: boolean }, ctx: Ctx): Promise<ImportResult> {
  const u = await deps.db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [v.userId]);
  if (!(await verifyPassword(u.rows[0]!.password_hash, input.password))) throw new ApiError(400, 'wrong_password', 'That is not your password.');
  const row = (await deps.db.query<{ sha256: string; created_at: Date; applied_at: Date | null }>(`SELECT sha256, created_at, applied_at FROM imports WHERE id = $1 AND user_id = $2`, [id, v.userId])).rows[0];
  if (!row) throw new ApiError(404, 'not_found', 'No such upload. Upload the archive again.');
  if (row.applied_at) throw new ApiError(409, 'already_applied', 'This archive has already been brought back.');
  if (row.created_at.getTime() + LIFETIME_MS < deps.now()) throw new ApiError(410, 'expired', 'That upload has expired. Upload the archive again.');
  const done = await deps.db.query(`SELECT 1 FROM imports WHERE user_id = $1 AND sha256 = $2 AND applied_at IS NOT NULL`, [v.userId, row.sha256]);
  if (done.rowCount) throw new ApiError(409, 'already_applied', 'This archive has already been brought back.');
  const zip = await fs.readFile(join(dir(deps), `${id}.zip`)).catch(() => { throw new ApiError(410, 'expired', 'That upload has expired. Upload the archive again.'); });
  const a = readArchive(zip, importMaxBytes(deps));
  await originOf(deps, v, a);

  const result: ImportResult = { parts: [] };
  const run = async (part: ImportPart, fn: () => Promise<{ restored: number; codes: string[] }>) => {
    if (!input.parts.includes(part)) return;
    const r = await fn();
    result.parts.push({ part, restored: r.restored, issues: tally(r.codes) });
  };
  const code = (e: unknown) => (e instanceof ApiError ? e.code : 'failed');

  await run('profile', async () => {
    const p = json<Record<string, unknown>>(a, 'profile.json');
    if (!p) return { restored: 0, codes: [] };
    const parsed = profileUpdateSchema.safeParse({ display_name: p.display_name ?? null, bio: p.bio ?? null, theme: p.theme ?? null, theme_variant: p.theme_variant ?? null, ...(typeof p.plan === 'string' ? { plan: p.plan } : {}) });
    if (!parsed.success) return { restored: 0, codes: ['invalid'] };
    await accounts.updateProfile(deps, v, parsed.data);
    return { restored: 1, codes: [] };
  });
  await run('settings', async () => {
    const s = json<Record<string, unknown>>(a, 'settings.json');
    if (!s) return { restored: 0, codes: [] };
    const codes: string[] = [];
    const parsed = profileUpdateSchema.safeParse({ status_line: s.status_line ?? null, away: s.away === true, show_last_seen: s.show_last_seen !== false, email_digest: s.email_digest === true });
    if (parsed.success) await accounts.updateProfile(deps, v, parsed.data); else codes.push('invalid');
    const notes = (s.notifications ?? {}) as Record<string, unknown>;
    for (const [kind, on] of Object.entries(notes)) if ((PREF_KINDS as readonly string[]).includes(kind) && typeof on === 'boolean') await personal.setPref(deps, v, kind, on);
    for (const slug of Array.isArray(s.muted_boards) ? s.muted_boards : []) {
      try { await personal.muteBoard(deps, v, String(slug), true); } catch { codes.push('board_missing'); }
    }
    // The wallpaper: their own picture first, then the choice (which may be that picture).
    const wp = (s.wallpaper ?? null) as { choice?: unknown; fit?: unknown; source_url?: unknown } | null;
    const pic = a.files.get('wallpaper.webp');
    if (pic) { try { await wallpaper.restore(deps, v.userId, pic, typeof wp?.source_url === 'string' ? wp.source_url : null); } catch (e) { codes.push(code(e)); } }
    if (wp) {
      const w = wallpaperUpdateSchema.safeParse({ choice: wp.choice, fit: wp.fit ?? 'cover' });
      if (w.success) { try { await wallpaper.choose(deps, v, w.data.choice, w.data.fit); } catch (e) { codes.push(code(e)); } } else codes.push('wallpaper_unknown');
    }
    // Mail conversations are kept by people, not ids, in an export, so their mutes can't be matched up.
    if (Array.isArray(s.muted_mail_conversations) && s.muted_mail_conversations.length) codes.push(...s.muted_mail_conversations.map(() => 'mail_mute'));
    return { restored: 1, codes };
  });
  await run('avatar', async () => {
    const pic = a.files.get('avatar.webp');
    if (!pic) return { restored: 0, codes: [] };
    try { await personal.setAvatar(deps, v, pic); return { restored: 1, codes: [] }; } catch (e) { return { restored: 0, codes: [code(e)] }; }
  });
  await run('homepage', async () => {
    const codes: string[] = [];
    let restored = 0;
    const settings = homepageSettingsSchema.safeParse(json(a, 'homepage.json') ? (({ title, description, guestbook_mode }) => ({ title, description, guestbook_mode }))(json<Record<string, unknown>>(a, 'homepage.json')!) : {});
    const existing = new Set((await deps.homes.tree(v.userId)).filter((e) => e.type === 'file').map((e) => e.path));
    for (const rel of homepageFiles(a)) {
      let path: string;
      try { path = cleanPath(rel); } catch { codes.push('bad_path'); continue; }
      if (existing.has(path) && !input.replace_homepage) { codes.push('exists'); continue; }
      try { await homes.putFile(deps, v, path, a.files.get(`homepage/${rel}`)!); restored += 1; } catch (e) { codes.push(code(e)); }
    }
    if (settings.success && Object.keys(settings.data).length) {
      try { await homes.updateSettings(deps, v, settings.data); } catch (e) { codes.push(code(e)); }
    }
    return { restored, codes };
  });
  await run('files', async () => {
    const codes: string[] = [];
    let restored = 0;
    for (const f of json<FileMeta[]>(a, 'files.json') ?? []) {
      const bytes = a.files.get(`files/${f.area}/${f.name}`);
      if (!bytes) { codes.push('missing'); continue; }
      try {
        await files.upload(deps, v, String(f.area), { name: String(f.name), title: String(f.title ?? '').slice(0, 120), description: String(f.description ?? '').slice(0, 2000) }, bytes);
        restored += 1;
      } catch (e) { codes.push(e instanceof ApiError && e.status === 404 ? 'area_missing' : code(e)); }
    }
    return { restored, codes };
  });
  await run('keys', async () => {
    const codes: string[] = [];
    let restored = 0;
    for (const line of keyLines(a)) {
      const [type, blob, ...name] = line.split(/\s+/);
      try { await addKey(deps, v.userId, { name: name.join(' ').replace(/_/g, ' '), public_key: `${type} ${blob}` }, ctx); restored += 1; } catch (e) { codes.push(code(e)); }
    }
    return { restored, codes };
  });

  await run('clients', async () => {
    const codes: string[] = [];
    let restored = 0;
    for (const name of CLIENT_NAMES) {
      const data = json<unknown>(a, `${name}/client.json`);
      if (data === null) continue;
      try { await putClientSettings(deps, v, name, data); restored += 1; } catch (e) { codes.push(code(e)); }
    }
    return { restored, codes };
  });

  await run('apps', async () => importAppData(deps, v, appInstallsOf(a), appDocsOf(a)));

  await deps.db.tx(async (q) => {
    await q.query(`UPDATE imports SET applied_at = now(), summary = $2 WHERE id = $1`, [id, JSON.stringify(result)]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'import.applied', targetType: 'user', targetId: v.userId,
      after: { archive_sha256: row.sha256, from: a.manifest.site.domain, parts: result.parts.map((p) => ({ part: p.part, restored: p.restored })) }, origin: 'web', ipHash: ctx.ipHash });
  });
  await fs.rm(join(dir(deps), `${id}.zip`), { force: true });
  return result;
}

// apps/installed.json and apps/{app}/{collection}.json, as the export writes them.
function appInstallsOf(a: Archive): string[] {
  const list = json<unknown>(a, 'apps/installed.json');
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
}
function appDocsOf(a: Archive): { app: string; collection: string; id: string; data: unknown }[] {
  const out: { app: string; collection: string; id: string; data: unknown }[] = [];
  for (const path of a.files.keys()) {
    const m = /^apps\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!m) continue;
    const docs = json<unknown>(a, path);
    if (!Array.isArray(docs)) continue;
    for (const d of docs) if (d && typeof d === 'object' && typeof (d as { id?: unknown }).id === 'string') out.push({ app: m[1]!, collection: m[2]!, id: (d as { id: string }).id, data: (d as { data?: unknown }).data });
  }
  return out;
}

// Uploads nobody applied are deleted after an hour, with their archives.
export async function pruneImports(deps: AppDeps): Promise<number> {
  const r = await deps.db.query<{ id: string }>(`DELETE FROM imports WHERE applied_at IS NULL AND created_at < to_timestamp($1 / 1000.0) RETURNING id`, [deps.now() - LIFETIME_MS]);
  for (const x of r.rows) await fs.rm(join(dir(deps), `${x.id}.zip`), { force: true });
  return r.rowCount;
}

// For account deletion: the uploads' archives on disk (the rows go with the account).
export async function removeImportFiles(deps: AppDeps, ids: string[]): Promise<void> {
  for (const id of ids) await fs.rm(join(dir(deps), `${id}.zip`), { force: true });
}
