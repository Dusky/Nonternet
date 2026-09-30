import type { AdminVouchCandidate, MyVouch } from '@app/shared';
import { audit } from './audit';
import { newId } from './crypto';
import { isUniqueViolation, type Queryable } from './db';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { Ctx, SessionUser } from './accounts';
import { changeRole } from './admin';

// Vouching (docs/03, Q10 decided 2026-09-30). Trusted people vouch for a user; with two vouches the person
// shows up ready in the admin console, where an admin confirms (the role changes to trusted) or declines.
// Nothing is automatic. If someone confirmed this way is demoted or suspended within SPONSOR_WINDOW_DAYS,
// each person who vouched for them gets a flag the admins see next time that person vouches.
export const VOUCHES_NEEDED = 2;
export const SPONSOR_WINDOW_DAYS = 90;
// Eligibility hints (docs/03 PROPOSED defaults). Shown to admins, never enforced.
export const HINTS = { minAgeDays: 30, minPosts: 25, cleanDays: 60 };

const mayVouch = (me: SessionUser) => {
  if (me.role !== 'trusted' && me.role !== 'admin') throw new ApiError(403, 'not_trusted', 'Only trusted people can vouch for someone.');
};

async function candidateByHandle(q: Queryable, handle: string): Promise<{ id: string; handle: string; role: string }> {
  const r = await q.query<{ id: string; handle: string; role: string; status: string }>(`SELECT id, handle, role, status FROM users WHERE lower(handle) = lower($1)`, [handle]);
  const u = r.rows[0];
  if (!u || u.status !== 'active') throw new ApiError(404, 'not_found', 'No such user.');
  return u;
}

export async function vouch(deps: AppDeps, me: SessionUser, handle: string, note: string, ctx: Ctx): Promise<void> {
  mayVouch(me);
  await deps.db.tx(async (q) => {
    const c = await candidateByHandle(q, handle);
    if (c.id === me.userId) throw new ApiError(400, 'self', 'You cannot vouch for yourself.');
    if (c.role === 'guest') throw new ApiError(409, 'not_confirmed', `${c.handle} has not confirmed their email address yet.`);
    if (c.role !== 'user') throw new ApiError(409, 'already_trusted', `${c.handle} is already trusted.`);
    try {
      await q.query(`INSERT INTO vouches (id, candidate_id, voucher_id, note) VALUES ($1, $2, $3, $4)`, [newId('vo'), c.id, me.userId, note]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError(409, 'already_vouched', `You have already vouched for ${c.handle}.`);
      throw e;
    }
    await audit(q, { actorId: me.userId, actorKind: 'user', action: 'vouch.created', targetType: 'user', targetId: c.id, after: { note }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function withdraw(deps: AppDeps, me: SessionUser, handle: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const c = await candidateByHandle(q, handle);
    const r = await q.query(`UPDATE vouches SET withdrawn_at = now() WHERE candidate_id = $1 AND voucher_id = $2 AND withdrawn_at IS NULL AND outcome IS NULL`, [c.id, me.userId]);
    if (!r.rowCount) throw new ApiError(404, 'not_vouched', `You have not vouched for ${c.handle}.`);
    await audit(q, { actorId: me.userId, actorKind: 'user', action: 'vouch.withdrawn', targetType: 'user', targetId: c.id, origin: 'web', ipHash: ctx.ipHash });
  });
}

// The open vouches this person has given, so a profile can show "You vouched" and offer to withdraw.
export async function myVouches(deps: AppDeps, me: SessionUser): Promise<MyVouch[]> {
  const r = await deps.db.query<{ handle: string; note: string; created_at: Date }>(
    `SELECT u.handle, v.note, v.created_at FROM vouches v JOIN users u ON u.id = v.candidate_id
     WHERE v.voucher_id = $1 AND v.withdrawn_at IS NULL AND v.outcome IS NULL ORDER BY v.created_at DESC`, [me.userId]);
  return r.rows.map((x) => ({ handle: x.handle, note: x.note, at: x.created_at.toISOString() }));
}

// Open vouches only count while the voucher is still trusted (or an admin) and active.
const OPEN = `v.withdrawn_at IS NULL AND v.outcome IS NULL`;
const COUNTS = `vu.role IN ('trusted', 'admin') AND vu.status = 'active'`;

export async function listCandidates(deps: AppDeps): Promise<AdminVouchCandidate[]> {
  const r = await deps.db.query<{
    candidate_id: string; handle: string; joined: Date; posts: number; mod_actions: number;
    vouch_id: string; voucher_id: string; voucher: string; note: string; at: Date; counts: boolean; flags: number;
  }>(
    `SELECT c.id AS candidate_id, c.handle, c.created_at AS joined,
            (SELECT count(*)::int FROM posts p WHERE p.author_id = c.id AND p.deleted_at IS NULL) AS posts,
            (SELECT count(*)::int FROM mod_actions m JOIN posts p ON p.id = m.post_id
              WHERE p.author_id = c.id AND m.undone_at IS NULL AND m.action IN ('hide', 'remove', 'lock') AND m.created_at > now() - make_interval(days => $1)) AS mod_actions,
            v.id AS vouch_id, vu.id AS voucher_id, vu.handle AS voucher, v.note, v.created_at AS at, (${COUNTS}) AS counts,
            (SELECT count(*)::int FROM sponsor_flags f WHERE f.voucher_id = vu.id) AS flags
     FROM vouches v JOIN users c ON c.id = v.candidate_id JOIN users vu ON vu.id = v.voucher_id
     WHERE ${OPEN} AND c.role = 'user' AND c.status = 'active'
     ORDER BY c.id, v.created_at`, [HINTS.cleanDays]);
  const by = new Map<string, AdminVouchCandidate>();
  for (const x of r.rows) {
    let c = by.get(x.candidate_id);
    if (!c) {
      const ageDays = Math.floor((Date.now() - x.joined.getTime()) / 86_400_000);
      c = {
        user: { id: x.candidate_id, handle: x.handle, joined_at: x.joined.toISOString() },
        vouches: [], ready: false,
        hints: {
          age_days: ageDays, posts: x.posts, recent_mod_actions: x.mod_actions,
          old_enough: ageDays >= HINTS.minAgeDays, enough_posts: x.posts >= HINTS.minPosts, clean: x.mod_actions === 0,
        },
      };
      by.set(x.candidate_id, c);
    }
    c.vouches.push({ id: x.vouch_id, voucher: { id: x.voucher_id, handle: x.voucher, flags: x.flags }, note: x.note, at: x.at.toISOString(), counts: x.counts });
  }
  const out = [...by.values()];
  for (const c of out) c.ready = c.vouches.filter((v) => v.counts).length >= VOUCHES_NEEDED;
  // Ready people first, then whoever has waited longest.
  return out.sort((a, b) => Number(b.ready) - Number(a.ready) || a.vouches[0]!.at.localeCompare(b.vouches[0]!.at));
}

export async function confirm(deps: AppDeps, admin: SessionUser, candidateId: string, reason: string | undefined, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const open = await q.query<{ id: string; voucher: string }>(
      `SELECT v.id, vu.handle AS voucher FROM vouches v JOIN users vu ON vu.id = v.voucher_id WHERE v.candidate_id = $1 AND ${OPEN} AND ${COUNTS} ORDER BY v.created_at FOR UPDATE OF v`, [candidateId]);
    if (open.rows.length < VOUCHES_NEEDED) throw new ApiError(409, 'not_enough_vouches', `This person needs ${VOUCHES_NEEDED} vouches from trusted people first.`);
    const why = reason?.trim() || `vouched for by ${open.rows.map((v) => v.voucher).join(' and ')}`;
    await changeRole(q, admin, candidateId, 'trusted', why, ctx);
    await q.query(`UPDATE vouches SET outcome = 'confirmed', decided_at = now(), decided_by = $2 WHERE id = ANY($1)`, [open.rows.map((v) => v.id), admin.userId]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'vouch.confirmed', targetType: 'user', targetId: candidateId,
      after: { vouchers: open.rows.map((v) => v.voucher), reason: why }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function decline(deps: AppDeps, admin: SessionUser, candidateId: string, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ id: string }>(`UPDATE vouches v SET outcome = 'declined', decided_at = now(), decided_by = $2 WHERE v.candidate_id = $1 AND ${OPEN} RETURNING v.id`, [candidateId, admin.userId]);
    if (!r.rowCount) throw new ApiError(404, 'not_found', 'Nobody has vouched for this person.');
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'vouch.declined', targetType: 'user', targetId: candidateId, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// Called inside the transaction that demotes or suspends someone. Flags each sponsor of a recent
// vouched promotion, once per vouch.
export async function flagSponsors(q: Queryable, candidateId: string, reason: 'demoted' | 'suspended'): Promise<number> {
  const r = await q.query(
    `INSERT INTO sponsor_flags (id, vouch_id, voucher_id, candidate_id, reason)
     SELECT 'sf_' || v.id, v.id, v.voucher_id, v.candidate_id, $2 FROM vouches v
     WHERE v.candidate_id = $1 AND v.outcome = 'confirmed' AND v.decided_at > now() - make_interval(days => $3)
     ON CONFLICT (vouch_id) DO NOTHING`, [candidateId, reason, SPONSOR_WINDOW_DAYS]);
  return r.rowCount ?? 0;
}

// For the dossier: who vouched for this person, and the flags on their own vouching.
export async function vouchDossier(deps: AppDeps, userId: string) {
  const [got, flags] = await Promise.all([
    deps.db.query<{ voucher: string; note: string; at: Date; outcome: string | null; withdrawn: boolean }>(
      `SELECT vu.handle AS voucher, v.note, v.created_at AS at, v.outcome, v.withdrawn_at IS NOT NULL AS withdrawn
       FROM vouches v JOIN users vu ON vu.id = v.voucher_id WHERE v.candidate_id = $1 ORDER BY v.created_at DESC LIMIT 20`, [userId]),
    deps.db.query<{ candidate: string; reason: string; at: Date }>(
      `SELECT c.handle AS candidate, f.reason, f.created_at AS at FROM sponsor_flags f JOIN users c ON c.id = f.candidate_id WHERE f.voucher_id = $1 ORDER BY f.created_at DESC`, [userId]),
  ]);
  return {
    vouched_by: got.rows.map((x) => ({ voucher: x.voucher, note: x.note, at: x.at.toISOString(), state: x.withdrawn ? 'withdrawn' : x.outcome ?? 'open' })),
    sponsor_flags: flags.rows.map((x) => ({ candidate: x.candidate, reason: x.reason, at: x.at.toISOString() })),
  };
}
