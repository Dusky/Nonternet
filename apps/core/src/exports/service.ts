import { ZipArchive } from 'archiver';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { audit } from '../audit';
import { newId } from '../crypto';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { verifyPassword } from '../passwords';
import { makeT } from '@app/strings';
import { toPublicSite } from '@app/shared';
import { EXPORTERS, sha256Hex, type ExportUser } from './exporters';
import { ensureKeypair, lockedPrivateKey, publicKeyFingerprint, signData } from './keys';
import type { Ctx, SessionUser } from '../accounts';
import { pruneImports } from '../imports';

const DAY = 86_400_000;
export const EXPORT_LIFETIME_DAYS = 7;
export const EXPORT_COOLDOWN_HOURS = 24;

export interface ExportView { id: string; status: 'queued' | 'running' | 'ready' | 'failed' | 'expired'; requested_at: string; ready_at: string | null; expires_at: string | null; size_bytes: number | null; includes_private_key: boolean; error: string | null }
interface Row { id: string; user_id: string; status: ExportView['status']; include_private_key: boolean; private_key_blob: string | null; requested_at: Date; ready_at: Date | null; expires_at: Date | null; size_bytes: string | null; error: string | null }
const view = (r: Row): ExportView => ({
  id: r.id, status: r.status, requested_at: r.requested_at.toISOString(), ready_at: r.ready_at ? r.ready_at.toISOString() : null, expires_at: r.expires_at ? r.expires_at.toISOString() : null,
  size_bytes: r.size_bytes === null ? null : Number(r.size_bytes), includes_private_key: r.include_private_key, error: r.error,
});

// Asking for an export needs the password again, so a stolen session cannot take everything a person has made.
export async function requestExport(deps: AppDeps, v: SessionUser, input: { password: string; include_private_key: boolean }, ctx: Ctx): Promise<ExportView> {
  const u = await deps.db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [v.userId]);
  if (!(await verifyPassword(u.rows[0]!.password_hash, input.password))) throw new ApiError(400, 'wrong_password', 'That is not your password.');
  const id = newId('x');
  const blob = input.include_private_key ? await deps.db.tx(async (q) => { await ensureKeypair(q, deps.secretKey, v.userId); return lockedPrivateKey(q, deps.secretKey, v.userId, input.password); }) : null;
  await deps.db.tx(async (q) => {
    await q.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [v.userId]);
    const recent = await q.query<{ requested_at: Date }>(
      `SELECT requested_at FROM exports WHERE user_id = $1 AND status <> 'failed' AND requested_at > to_timestamp($2 / 1000.0) ORDER BY requested_at DESC LIMIT 1`, [v.userId, deps.now() - EXPORT_COOLDOWN_HOURS * 3_600_000]);
    if (recent.rows[0]) {
      const next = new Date(recent.rows[0].requested_at.getTime() + EXPORT_COOLDOWN_HOURS * 3_600_000);
      throw new ApiError(429, 'export_rate_limited', `You can ask for one export a day. You can ask again after ${next.toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
    }
    await q.query(`INSERT INTO exports (id, user_id, include_private_key, private_key_blob) VALUES ($1, $2, $3, $4)`, [id, v.userId, input.include_private_key, blob]);
    await audit(q, { actorId: v.userId, actorKind: 'user', action: 'export.requested', targetType: 'export', targetId: id, after: { include_private_key: input.include_private_key }, origin: 'web', ipHash: ctx.ipHash });
  });
  return (await listExports(deps, v)).find((e) => e.id === id)!;
}

export async function listExports(deps: AppDeps, v: SessionUser): Promise<ExportView[]> {
  const r = await deps.db.query<Row>(`SELECT id, user_id, status, include_private_key, private_key_blob, requested_at, ready_at, expires_at, size_bytes, error FROM exports WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 20`, [v.userId]);
  return r.rows.map(view);
}

export async function downloadTarget(deps: AppDeps, v: SessionUser, id: string, ctx: Ctx): Promise<{ path: string; name: string; size: number }> {
  const r = await deps.db.query<Row & { handle: string }>(`SELECT e.*, u.handle FROM exports e JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND e.user_id = $2`, [id, v.userId]);
  const e = r.rows[0];
  if (!e) throw new ApiError(404, 'not_found', 'No such export.');
  if (e.status === 'expired' || (e.expires_at && e.expires_at.getTime() < deps.now())) throw new ApiError(410, 'expired', 'That export has expired. Ask for a new one.');
  if (e.status !== 'ready') throw new ApiError(409, 'not_ready', 'That export is not ready yet.');
  await audit(deps.db, { actorId: v.userId, actorKind: 'user', action: 'export.downloaded', targetType: 'export', targetId: id, origin: 'web', ipHash: ctx.ipHash });
  return { path: join(deps.exportsDir, `${id}.zip`), name: `${e.handle}-${new Date(e.ready_at!).toISOString().slice(0, 10)}.zip`, size: Number(e.size_bytes) };
}

// ---------------------------------------------------------------- the worker

const README = (site: { name: string; domain: string }, handle: string) => `This is everything you made on ${site.name} (${site.domain}), as of the date in manifest.json.

profile.json      your account details, rings, memberships and role history
settings.json     your status line, notification choices and mutes
avatar.webp       your picture, if you have one
homepage/         your homepage files, exactly as you uploaded them (homepage.json has the settings)
guestbook.json    entries on your guestbook, and entries you signed elsewhere
posts/posts.json  every post you wrote: board, thread, subject, text, date (revisions.json and reactions.json beside it)
posts/posts.mbox  the same posts as a mailbox, for mail and news readers
mail/             your conversations: who was in them and the messages you wrote
files/            files you uploaded to file areas (files.json has their details)
rings/            for rings you founded or help run: the profile and the member list
boards/           for boards you own: the board's details
irc/              chat channels you registered and your own chat messages
mud/              your characters in the game, and notes you left there
classics.json     lines you put on the wall, polls you asked and votes you cast
vouches.json      people you vouched for
keys/public.key   your public key (Ed25519); ssh_authorized_keys has your SSH keys
keys/private.key.json  only if you asked for it: your private key, locked with the password you gave
manifest.json     every file here with its size and SHA-256 hash
manifest.sig      a signature of manifest.json made with your key

Not included: other people's posts and messages. Nothing you did not make is here.

To bring your profile, settings, picture, homepage, files and SSH keys back, upload this zip under
Settings, Your data, "Bring back an export".

To check that nothing changed since the export was made, and that ${site.name} made it for ${handle}:
  1. Compare each file's SHA-256 with manifest.json.
  2. Check manifest.sig against manifest.json with keys/public.key. With OpenSSL 3:
       base64 -d manifest.sig > manifest.sig.bin
       openssl pkeyutl -verify -pubin -inkey keys/public.key -rawin -in manifest.json -sigfile manifest.sig.bin
`;

export async function buildArchive(deps: AppDeps, row: Row, target: string): Promise<{ size: number; sha256: string }> {
  const u = await deps.db.query<ExportUser>(`SELECT id, handle, display_name, bio, plan, pronouns, location, links, email, role, theme, theme_variant, created_at, public_key FROM users WHERE id = $1`, [row.user_id]);
  const user = u.rows[0]!;
  const { publicPem } = await deps.db.tx((q) => ensureKeypair(q, deps.secretKey, user.id));
  user.public_key = publicPem;
  const site = { name: deps.config.site.name, domain: deps.config.site.domain };

  await fs.mkdir(deps.exportsDir, { recursive: true });
  const out = createWriteStream(target);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => { out.on('close', resolve); out.on('error', reject); archive.on('error', reject); });
  archive.pipe(out);

  const files: { path: string; size: number; sha256: string }[] = [];
  const put = (path: string, data: string | Buffer) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    files.push({ path, size: buf.length, sha256: sha256Hex(buf) });
    archive.append(buf, { name: path, date: new Date(0) });
  };
  for (const ex of EXPORTERS) await ex.run({ deps, user, add: put });
  if (row.include_private_key && row.private_key_blob) put('keys/private.key.json', row.private_key_blob);
  put('README.txt', README(site, user.handle));

  const manifest = Buffer.from(`${JSON.stringify({
    format: 'export-v1', generated_at: new Date(deps.now()).toISOString(), site, user: { id: user.id, handle: user.handle },
    public_key_fingerprint: publicKeyFingerprint(publicPem), hash: 'sha256', files: files.sort((a, b) => a.path.localeCompare(b.path)),
  }, null, 2)}\n`, 'utf8');
  archive.append(manifest, { name: 'manifest.json', date: new Date(0) });
  archive.append(await deps.db.tx((q) => signData(q, deps.secretKey, user.id, manifest)), { name: 'manifest.sig', date: new Date(0) });
  await archive.finalize();
  await done;

  const hash = await new Promise<string>((resolve, reject) => {
    const h = sha256Stream();
    createReadStream(target).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest())).on('error', reject);
  });
  return { size: (await fs.stat(target)).size, sha256: hash };
}
import { createHash } from 'node:crypto';
const sha256Stream = () => { const h = createHash('sha256'); return { update: (c: string | Buffer) => h.update(c), digest: () => h.digest('hex') }; };

// Builds one queued export, if there is one. Returns whether it did any work.
export async function processNext(deps: AppDeps, log: (m: string) => void = () => undefined): Promise<boolean> {
  const claimed = await deps.db.query<Row>(
    `UPDATE exports SET status = 'running', started_at = now() WHERE id = (SELECT id FROM exports WHERE status = 'queued' ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, user_id, status, include_private_key, private_key_blob, requested_at, ready_at, expires_at, size_bytes, error`);
  const row = claimed.rows[0];
  if (!row) return false;
  const target = join(deps.exportsDir, `${row.id}.zip`);
  try {
    const built = await buildArchive(deps, row, `${target}.part`);
    await fs.rename(`${target}.part`, target);
    await deps.db.query(
      `UPDATE exports SET status = 'ready', ready_at = now(), expires_at = now() + make_interval(days => $2), size_bytes = $3, sha256 = $4, private_key_blob = NULL, error = NULL WHERE id = $1`,
      [row.id, EXPORT_LIFETIME_DAYS, built.size, built.sha256]);
    const u = await deps.db.query<{ email: string; handle: string }>(`SELECT email, handle FROM users WHERE id = $1`, [row.user_id]);
    const t = makeT(toPublicSite(deps.config));
    void deps.mailer.send({ to: u.rows[0]!.email, subject: t('email.export.subject'), text: t('email.export.body', { handle: u.rows[0]!.handle, link: `${deps.publicUrl}/settings/data`, days: EXPORT_LIFETIME_DAYS }) }).catch((e) => log(`export email failed: ${e}`));
  } catch (err) {
    log(`export ${row.id} failed: ${err instanceof Error ? err.message : err}`);
    await fs.rm(`${target}.part`, { force: true });
    await deps.db.query(`UPDATE exports SET status = 'failed', error = 'The export could not be built. Try again later; the admins have been told.', private_key_blob = NULL WHERE id = $1`, [row.id]);
  }
  return true;
}

// Expired exports are deleted from disk. Ones stuck "running" (the server stopped mid-build) are failed so people can retry.
export async function pruneExports(deps: AppDeps): Promise<number> {
  const old = await deps.db.query<{ id: string }>(`UPDATE exports SET status = 'expired' WHERE status = 'ready' AND expires_at < to_timestamp($1 / 1000.0) RETURNING id`, [deps.now()]);
  for (const r of old.rows) await fs.rm(join(deps.exportsDir, `${r.id}.zip`), { force: true });
  await deps.db.query(`UPDATE exports SET status = 'failed', error = 'The export was interrupted. Ask again.', private_key_blob = NULL WHERE status = 'running' AND started_at < now() - interval '30 minutes'`);
  return old.rowCount;
}

export function startExportWorker(deps: AppDeps, log: (m: string) => void): { stop(): Promise<void> } {
  let stopped = false;
  let busy: Promise<void> = Promise.resolve();
  let lastPrune = 0;
  const tick = async () => {
    try {
      while (!stopped && (await processNext(deps, log))) { /* drain the queue */ }
      if (Date.now() - lastPrune > 600_000) { lastPrune = Date.now(); await pruneExports(deps); await pruneImports(deps); }
    } catch (e) { log(`export worker: ${e}`); }
  };
  const timer = setInterval(() => { busy = busy.then(tick); }, 5000);
  return { async stop() { stopped = true; clearInterval(timer); await busy; } };
}
