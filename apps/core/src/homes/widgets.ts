import { audit } from '../audit';
import { newId, sha256 } from '../crypto';
import type { Queryable } from '../db';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { normalizeBody } from '../text';
import type { Ctx, SessionUser } from '../accounts';

export interface GuestbookEntryView { id: string; name: string; url: string | null; message: string; at: string; status: 'visible' | 'pending' | 'hidden'; member: string | null }

interface Owner { id: string; handle: string; guestbook_mode: 'open' | 'approval' | 'off'; last_updated_at: Date | null; last_seen_at: Date | null }

// A homepage that can be reached at all: an active person whose page is not hidden.
async function ownerOf(q: Queryable, handle: string): Promise<Owner> {
  const r = await q.query<Owner>(
    `SELECT u.id, u.handle, COALESCE(h.guestbook_mode, 'open') AS guestbook_mode, h.last_updated_at, u.last_seen_at
     FROM users u LEFT JOIN homepages h ON h.user_id = u.id WHERE lower(u.handle) = lower($1) AND u.status = 'active' AND h.hidden_at IS NULL AND u.role <> 'guest'`, [handle]);
  if (!r.rows[0]) throw new ApiError(404, 'not_found', 'There is no homepage with that name.');
  return r.rows[0];
}

const view = (r: { id: string; name: string; url: string | null; message: string; created_at: Date; status: GuestbookEntryView['status']; member: string | null }): GuestbookEntryView =>
  ({ id: r.id, name: r.name, url: r.url, message: r.message, at: r.created_at.toISOString(), status: r.status, member: r.member });

// Only http and https, so a guestbook link can never be a javascript: address.
export function cleanUrl(input: string | undefined): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `http://${s}`); } catch { throw new ApiError(400, 'bad_url', 'That web address does not look right.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ApiError(400, 'bad_url', 'Web addresses must start with http:// or https://.');
  if (s.length > 200) throw new ApiError(400, 'bad_url', 'That web address is too long.');
  return u.toString();
}
const cleanName = (s: string) => {
  const n = s.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  if (!n) throw new ApiError(400, 'empty_name', 'Give a name.');
  if ([...n].length > 40) throw new ApiError(400, 'name_too_long', 'A name can be up to 40 characters.');
  return n;
};

export async function listGuestbook(deps: AppDeps, handle: string, opts: { before?: string; limit?: number }): Promise<{ entries: GuestbookEntryView[]; mode: string; next: string | null }> {
  const o = await ownerOf(deps.db, handle);
  const limit = Math.min(opts.limit ?? 20, 50);
  const r = await deps.db.query<{ id: string; name: string; url: string | null; message: string; created_at: Date; status: GuestbookEntryView['status']; member: string | null }>(
    `SELECT g.id, g.name, g.url, g.message, g.created_at, g.status, u.handle AS member FROM guestbook_entries g LEFT JOIN users u ON u.id = g.author_id
     WHERE g.home_user_id = $1 AND g.status = 'visible'
       AND ($2::text IS NULL OR (g.created_at, g.id) < (SELECT created_at, id FROM guestbook_entries WHERE id = $2))
     ORDER BY g.created_at DESC, g.id DESC LIMIT $3`, [o.id, opts.before ?? null, limit + 1]);
  const page = r.rows.slice(0, limit);
  return { entries: page.map(view), mode: o.guestbook_mode, next: r.rows.length > limit ? page[page.length - 1]!.id : null };
}

// Signing. Anyone can, without an account; a signed-in person's name is their own and cannot be faked.
export async function sign(
  deps: AppDeps, handle: string, input: { name?: string; url?: string; message: string; website?: string }, who: SessionUser | null, ctx: Ctx,
): Promise<{ status: 'visible' | 'pending' }> {
  const o = await ownerOf(deps.db, handle);
  if (o.guestbook_mode === 'off') throw new ApiError(403, 'guestbook_closed', 'This guestbook is closed.');
  const message = normalizeBody(input.message);
  if ([...message].length > 500) throw new ApiError(400, 'message_too_long', 'A guestbook message can be up to 500 characters.');
  const name = who ? (who.displayName || who.handle) : cleanName(input.name ?? '');
  const url = cleanUrl(input.url);
  const status = o.guestbook_mode === 'approval' && who?.userId !== o.id ? 'pending' : 'visible';
  // Bots fill in every field. A hidden field a person never sees gets a fake "thanks" and nothing is stored.
  if (input.website) return { status };
  if (deps.rateLimit) {
    const n = await deps.db.query<{ n: string }>(`SELECT count(*) AS n FROM guestbook_entries WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`, [ctx.ipHash]);
    if (Number(n.rows[0]!.n) >= 5) throw new ApiError(429, 'rate_limited', 'You have signed a lot of guestbooks. Wait a while and try again.');
  }
  await deps.db.query(
    `INSERT INTO guestbook_entries (id, home_user_id, author_id, name, url, message, status, ip_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [newId('g'), o.id, who?.userId ?? null, name, url, message, status, ctx.ipHash]);
  return { status };
}

// The owner's view of their own guestbook, including what is waiting for approval.
export async function listMine(deps: AppDeps, v: SessionUser, status: string | undefined): Promise<{ entries: GuestbookEntryView[] }> {
  const r = await deps.db.query<{ id: string; name: string; url: string | null; message: string; created_at: Date; status: GuestbookEntryView['status']; member: string | null }>(
    `SELECT g.id, g.name, g.url, g.message, g.created_at, g.status, u.handle AS member FROM guestbook_entries g LEFT JOIN users u ON u.id = g.author_id
     WHERE g.home_user_id = $1 AND ($2::text IS NULL OR g.status = $2) ORDER BY g.created_at DESC, g.id DESC LIMIT 200`, [v.userId, status ?? null]);
  return { entries: r.rows.map(view) };
}

export async function moderateEntry(deps: AppDeps, v: SessionUser, id: string, status: 'visible' | 'hidden'): Promise<void> {
  const r = await deps.db.query(`UPDATE guestbook_entries SET status = $3 WHERE id = $1 AND home_user_id = $2`, [id, v.userId, status]);
  if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'No such entry in your guestbook.');
}

// ---------------------------------------------------------------- counter, stamp, online

export async function hit(deps: AppDeps, handle: string, ctx: Ctx): Promise<{ count: number }> {
  const o = await ownerOf(deps.db, handle);
  return deps.db.tx(async (q) => {
    await q.query(`INSERT INTO home_hits (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [o.id]);
    const day = new Date(deps.now()).toISOString().slice(0, 10);
    const seen = await q.query(`INSERT INTO home_hit_seen (user_id, day, visitor_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [o.id, day, sha256(`${ctx.ipHash}|${ctx.userAgent ?? ''}`)]);
    const t = await q.query<{ total: string }>(seen.rowCount > 0 ? `UPDATE home_hits SET total = total + 1 WHERE user_id = $1 RETURNING total` : `SELECT total FROM home_hits WHERE user_id = $1`, [o.id]);
    await q.query(`DELETE FROM home_hit_seen WHERE user_id = $1 AND day < $2::date - 2`, [o.id, day]);
    return { count: Number(t.rows[0]!.total) };
  });
}

export async function count(deps: AppDeps, handle: string): Promise<{ count: number }> {
  const o = await ownerOf(deps.db, handle);
  const r = await deps.db.query<{ total: string }>(`SELECT total FROM home_hits WHERE user_id = $1`, [o.id]);
  return { count: Number(r.rows[0]?.total ?? 0) };
}

export async function status(deps: AppDeps, handle: string): Promise<{ updated: string | null; online: boolean }> {
  const o = await ownerOf(deps.db, handle);
  // "Online" means seen on the site in the last 5 minutes (PROPOSED until real presence exists).
  return { updated: o.last_updated_at ? o.last_updated_at.toISOString() : null, online: o.last_seen_at !== null && deps.now() - o.last_seen_at.getTime() < 5 * 60_000 };
}

// ---------------------------------------------------------------- reporting a homepage or an entry

export async function reportHomepage(deps: AppDeps, v: SessionUser, handle: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  if (v.role === 'guest') throw new ApiError(403, 'email_not_verified', 'Confirm your email address to report a page.');
  const r = await deps.db.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1) AND status = 'active'`, [handle]);
  const target = r.rows[0];
  if (!target) throw new ApiError(404, 'not_found', 'There is no homepage with that name.');
  if (target.id === v.userId) throw new ApiError(409, 'own_post', 'That is your own page.');
  return file(deps, v, 'homepage', target.id, category, note, ctx);
}

export async function reportEntry(deps: AppDeps, v: SessionUser, entryId: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  if (v.role === 'guest') throw new ApiError(403, 'email_not_verified', 'Confirm your email address to report an entry.');
  const r = await deps.db.query<{ id: string }>(`SELECT id FROM guestbook_entries WHERE id = $1 AND status = 'visible'`, [entryId]);
  if (!r.rows[0]) throw new ApiError(404, 'not_found', 'No such entry.');
  return file(deps, v, 'guestbook', entryId, category, note, ctx);
}

async function file(deps: AppDeps, v: SessionUser, type: 'homepage' | 'guestbook', targetId: string, category: string, note: string, ctx: Ctx): Promise<{ id: string }> {
  const id = newId('rp');
  try {
    await deps.db.tx(async (q) => {
      await q.query(`INSERT INTO reports (id, target_type, target_id, scope_type, scope_id, reporter_id, category, note) VALUES ($1, $2, $3, 'site', 'site', $4, $5, $6)`, [id, type, targetId, v.userId, category, note]);
      await audit(q, { actorId: v.userId, actorKind: 'user', action: 'report.created', targetType: type, targetId, after: { category }, origin: 'web', ipHash: ctx.ipHash });
    });
  } catch (err) {
    if ((err as { constraint?: string }).constraint === 'reports_one_open') throw new ApiError(409, 'already_reported', 'You already reported this. The admins have it.');
    throw err;
  }
  return { id };
}

// An admin hides an entry someone reported (docs/03). The owner can only hide entries in their own guestbook.
export async function adminHideEntry(deps: AppDeps, admin: SessionUser, id: string, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ status: string }>(`SELECT status FROM guestbook_entries WHERE id = $1 FOR UPDATE`, [id]);
    if (!r.rows[0]) throw new ApiError(404, 'not_found', 'No such entry.');
    if (r.rows[0].status === 'hidden') throw new ApiError(409, 'no_change', 'That entry is already hidden.');
    await q.query(`UPDATE guestbook_entries SET status = 'hidden' WHERE id = $1`, [id]);
    await q.query(`UPDATE reports SET status = 'actioned', resolved_by = $2, resolved_at = now(), resolution_note = $3 WHERE target_type = 'guestbook' AND target_id = $1 AND status = 'open'`, [id, admin.userId, `Hidden by an admin: ${reason}`]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'guestbook.hidden', targetType: 'guestbook', targetId: id, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
  });
}
