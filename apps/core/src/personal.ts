import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { AVATAR_MAX_BYTES, AVATAR_SIZE, PREF_KINDS, toPublicSite, type DirectoryEntry, type LastSeen, type NotificationPrefs, type PersonalSettings } from '@app/shared';
import type { SessionUser } from './accounts';
import { audit } from './audit';
import { isMember, loadBoard } from './boards';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { makeT } from '@app/strings';

// Personal touches (M9-D, docs/10, 12): avatars, preferences, the people directory and the daily digest.

const member = (v: SessionUser) => { if (!isMember(v)) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first.'); };

// ---------------------------------------------------------------- avatars

const avatarPath = (deps: AppDeps, userId: string) => join(deps.filesDir, 'avatars', `${userId}.webp`);

// The upload is decoded and drawn again, so what is kept is always a plain 256×256 picture: no metadata (location,
// camera), no animation, nothing the browser could be tricked by. Anything that is not a PNG, JPEG or WebP is refused.
export async function setAvatar(deps: AppDeps, v: SessionUser, data: Buffer): Promise<{ version: number }> {
  member(v);
  if (!data.length) throw new ApiError(400, 'empty', 'Choose a picture to upload.');
  if (data.length > AVATAR_MAX_BYTES) throw new ApiError(413, 'too_big', 'That picture is too big. Avatars can be up to 2 MB.');
  let out: Buffer;
  try {
    const img = sharp(data, { limitInputPixels: 40_000_000, failOn: 'error' });
    const meta = await img.metadata();
    if (!meta.format || !['png', 'jpeg', 'webp'].includes(meta.format)) throw new Error('format');
    out = await img.rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw new ApiError(400, 'bad_image', 'That does not look like a PNG, JPEG or WebP picture.');
  }
  await fs.mkdir(join(deps.filesDir, 'avatars'), { recursive: true });
  await fs.writeFile(avatarPath(deps, v.userId), out);
  const r = await deps.db.query<{ at: Date }>(`UPDATE users SET avatar_at = now(), updated_at = now() WHERE id = $1 RETURNING avatar_at AS at`, [v.userId]);
  return { version: r.rows[0]!.at.getTime() };
}

export async function clearAvatar(deps: AppDeps, userId: string): Promise<void> {
  await deps.db.query(`UPDATE users SET avatar_at = NULL, updated_at = now() WHERE id = $1`, [userId]);
  await fs.rm(avatarPath(deps, userId), { force: true });
}

// An admin takes an avatar down (docs/03): the person keeps their account, and the removal is on the record.
export async function removeAvatarAsAdmin(deps: AppDeps, admin: SessionUser, userId: string, reason: string, ipHash?: string): Promise<void> {
  const had = await deps.db.query(`SELECT 1 FROM users WHERE id = $1 AND avatar_at IS NOT NULL`, [userId]);
  if (!had.rowCount) throw new ApiError(404, 'not_found', 'That person has no avatar.');
  await clearAvatar(deps, userId);
  await audit(deps.db, { actorId: admin.userId, actorKind: 'user', action: 'user.avatar_removed', targetType: 'user', targetId: userId, after: { reason }, origin: 'web', ipHash });
}

export async function readAvatar(deps: AppDeps, v: SessionUser, userId: string): Promise<{ data: Buffer; version: number } | null> {
  member(v);
  const r = await deps.db.query<{ at: Date | null }>(`SELECT avatar_at AS at FROM users WHERE id = $1 AND status = 'active'`, [userId]);
  const at = r.rows[0]?.at;
  if (!at) return null;
  try { return { data: await fs.readFile(avatarPath(deps, userId)), version: at.getTime() }; } catch { return null; }
}

// Who has an avatar and when it last changed, so the shell draws a picture only where there is one (no failed
// image requests for everyone else). One small list for a small site; if it ever grows past that, page it.
export async function avatarVersions(deps: AppDeps, v: SessionUser): Promise<Record<string, number>> {
  member(v);
  const r = await deps.db.query<{ id: string; at: Date }>(`SELECT id, avatar_at AS at FROM users WHERE avatar_at IS NOT NULL AND status = 'active' LIMIT 5000`);
  return Object.fromEntries(r.rows.map((u) => [u.id, u.at.getTime()]));
}

// ---------------------------------------------------------------- preferences

// With no SMTP server mail is only logged, so a digest would reach nobody: the option is not offered.
export const canEmail = (deps: AppDeps): boolean => deps.mailer.real === true;

export function defaultPrefs(): NotificationPrefs {
  return Object.fromEntries(PREF_KINDS.map((k) => [k, true])) as NotificationPrefs;
}

export async function getSettings(deps: AppDeps, v: SessionUser): Promise<PersonalSettings> {
  const u = await deps.db.query<{ status_line: string | null; plan: string; away: boolean; avatar_at: Date | null; show_last_seen: boolean; email_digest: boolean }>(
    `SELECT status_line, plan, away, avatar_at, show_last_seen, email_digest FROM users WHERE id = $1`, [v.userId]);
  const prefs = defaultPrefs();
  for (const r of (await deps.db.query<{ kind: keyof NotificationPrefs; enabled: boolean }>(`SELECT kind, enabled FROM notification_prefs WHERE user_id = $1`, [v.userId])).rows) {
    if (r.kind in prefs) prefs[r.kind] = r.enabled;
  }
  const muted = await deps.db.query<{ slug: string; name: string }>(
    `SELECT b.slug, b.name FROM board_notification_prefs p JOIN boards b ON b.id = p.board_id WHERE p.user_id = $1 ORDER BY b.name`, [v.userId]);
  const x = u.rows[0]!;
  return {
    status_line: x.status_line, plan: x.plan, away: x.away, has_avatar: x.avatar_at !== null, show_last_seen: x.show_last_seen, email_digest: x.email_digest,
    can_email: canEmail(deps), prefs, muted_boards: muted.rows,
  };
}

export async function setPref(deps: AppDeps, v: SessionUser, kind: string, enabled: boolean): Promise<void> {
  await deps.db.query(
    `INSERT INTO notification_prefs (user_id, kind, enabled) VALUES ($1, $2, $3) ON CONFLICT (user_id, kind) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [v.userId, kind, enabled]);
}

export async function muteBoard(deps: AppDeps, v: SessionUser, slug: string, on: boolean): Promise<void> {
  member(v);
  const b = await loadBoard(deps.db, slug, v); // you can only mute what you can read
  if (on) await deps.db.query(`INSERT INTO board_notification_prefs (user_id, board_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [v.userId, b.id]);
  else await deps.db.query(`DELETE FROM board_notification_prefs WHERE user_id = $1 AND board_id = $2`, [v.userId, b.id]);
}

export async function muteThread(deps: AppDeps, v: SessionUser, threadId: string, on: boolean): Promise<void> {
  member(v);
  const p = await deps.db.query(`SELECT 1 FROM mail_participants WHERE thread_id = $1 AND user_id = $2`, [threadId, v.userId]);
  if (!p.rowCount) throw new ApiError(404, 'not_found', 'No such conversation.');
  if (on) await deps.db.query(`INSERT INTO mail_mutes (user_id, thread_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [v.userId, threadId]);
  else await deps.db.query(`DELETE FROM mail_mutes WHERE user_id = $1 AND thread_id = $2`, [v.userId, threadId]);
}

// ---------------------------------------------------------------- directory

export function coarseLastSeen(at: Date | null, show: boolean, now = Date.now()): LastSeen | null {
  if (!at || !show) return null;
  const age = now - at.getTime();
  return age < 86_400_000 ? 'today' : age < 7 * 86_400_000 ? 'this_week' : 'a_while';
}

// Confirmed, active people, most recently around first. Someone who hides when they were last here is ordered by
// when they joined instead, so the order does not give the hidden time away.
export async function directory(deps: AppDeps, v: SessionUser, opts: { q?: string; role?: string; offset?: number }): Promise<{ people: DirectoryEntry[]; next: number | null }> {
  member(v);
  const limit = 30;
  const like = opts.q ? `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const r = await deps.db.query<{ id: string; handle: string; display_name: string | null; role: DirectoryEntry['role']; status_line: string | null; away: boolean; last_seen_at: Date | null; show_last_seen: boolean }>(
    `SELECT id, handle, display_name, role, status_line, away, last_seen_at, show_last_seen FROM users
      WHERE status = 'active' AND role <> 'guest' AND ($1::text IS NULL OR handle ILIKE $1 ESCAPE '\\' OR display_name ILIKE $1 ESCAPE '\\') AND ($2::text IS NULL OR role = $2)
      ORDER BY (CASE WHEN show_last_seen THEN COALESCE(last_seen_at, created_at) ELSE created_at END) DESC, id LIMIT $3 OFFSET $4`,
    [like, opts.role ?? null, limit + 1, opts.offset ?? 0]);
  const rows = r.rows.slice(0, limit);
  return {
    people: rows.map((u) => ({ id: u.id, handle: u.handle, display_name: u.display_name, role: u.role, status_line: u.status_line, away: u.away, last_seen: coarseLastSeen(u.last_seen_at, u.show_last_seen) })),
    next: r.rows.length > limit ? (opts.offset ?? 0) + limit : null,
  };
}

// ---------------------------------------------------------------- daily digest

// For people who asked for it: one email a day, only when there is something they have not seen. Runs hourly.
export async function sendDigests(deps: AppDeps): Promise<number> {
  if (!canEmail(deps)) return 0;
  const due = await deps.db.query<{ id: string; email: string; handle: string; since: Date }>(
    `SELECT id, email, handle, COALESCE(digest_sent_at, now() - interval '1 day') AS since FROM users
      WHERE email_digest AND status = 'active' AND role <> 'guest' AND email_verified_at IS NOT NULL
        AND (digest_sent_at IS NULL OR digest_sent_at < now() - interval '23 hours')`);
  let sent = 0;
  for (const u of due.rows) {
    const n = await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL AND created_at > $2`, [u.id, u.since]);
    const m = await deps.db.query<{ n: string }>(
      `SELECT count(*) AS n FROM mail_participants p WHERE p.user_id = $1 AND p.left_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM mail_mutes x WHERE x.user_id = $1 AND x.thread_id = p.thread_id)
         AND EXISTS (SELECT 1 FROM mail_messages g WHERE g.thread_id = p.thread_id AND g.kind = 'message' AND g.author_id IS DISTINCT FROM $1
           AND g.created_at > $2 AND (p.last_read_at IS NULL OR g.created_at > p.last_read_at))`, [u.id, u.since]);
    const notes = Number(n.rows[0]!.n); const mail = Number(m.rows[0]!.n);
    await deps.db.query(`UPDATE users SET digest_sent_at = now() WHERE id = $1`, [u.id]); // even when empty: look again tomorrow
    if (!notes && !mail) continue;
    const t = makeT(toPublicSite(deps.config));
    await deps.mailer.send({ to: u.email, subject: t('email.digest.subject', { count: notes + mail }), text: t('email.digest.body', { handle: u.handle, notes, mail, url: deps.publicUrl }) }).catch(() => undefined);
    sent++;
  }
  return sent;
}
