import { createHash } from 'node:crypto';
import { audit } from '../audit';
import type { AppDeps } from '../deps';
import { newId, randomToken, sha256 } from '../crypto';
import { ApiError } from '../errors';
import { noteActive } from '../activity';
import { checkTerminalLogin } from '../irc/auth';
import { bbsNodes, setBbsNodes, type BbsNodeState } from '../presence';
import type { Ctx, SessionUser } from '../accounts';
import * as accounts from '../accounts';
import type { SignupInput } from '@app/shared';

// Signing BBS callers in (docs/04). The BBS never sees a user table: it asks core, and core answers with a
// short-lived ordinary session (kind 'bbs') that the BBS uses to call the public API as that person. So
// roles, ops, bans, quotas and the audit log apply exactly as on the web.
const SESSION_HOURS = 12;
export type BbsVia = 'telnet' | 'ssh' | 'web';
export interface BbsLogin { token: string; call_id: string; user: { id: string; handle: string; role: string }; last_call_at: string | null }

async function openSession(deps: AppDeps, user: { id: string; handle: string; role: string }, via: BbsVia, node: number, ipHash: string | null): Promise<BbsLogin> {
  const token = randomToken();
  const callId = newId('bc');
  let last: Date | null = null;
  await deps.db.tx(async (q) => {
    last = (await q.query<{ at: Date | null }>(`SELECT max(connected_at) AS at FROM bbs_calls WHERE user_id = $1`, [user.id])).rows[0]?.at ?? null;
    const t = await q.query<{ totp_enabled_at: Date | null }>(`SELECT totp_enabled_at FROM users WHERE id = $1`, [user.id]);
    const limited = deps.config.security.require_admin_2fa && user.role === 'admin' && !t.rows[0]?.totp_enabled_at;
    await q.query(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_hash, limited, expires_at, kind)
       VALUES ($1, $2, $3, $4, $5, $6, now() + $7 * interval '1 hour', 'bbs')`,
      [newId('s'), user.id, sha256(token), `bbs (${via})`, ipHash, limited, SESSION_HOURS]);
    await q.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [user.id]);
    await q.query(`INSERT INTO bbs_calls (id, user_id, node, via) VALUES ($1, $2, $3, $4)`, [callId, user.id, node, via]);
  });
  noteActive(deps, user.id, 'bbs');
  return { token, call_id: callId, user: { id: user.id, handle: user.handle, role: user.role }, last_call_at: (last as Date | null)?.toISOString() ?? null };
}

// Signing up from the terminal (docs/04). The same rules as the web (accounts.signup); the limit is per caller's
// address, counted from the audit log, since internal routes have no rate limiter.
export const BBS_SIGNUPS_PER_HOUR = 3;
export async function signupFromBbs(deps: AppDeps, input: SignupInput, ipHash: string | null): Promise<{ id: string; handle: string }> {
  const recent = await deps.db.query<{ n: string }>(
    `SELECT count(*) AS n FROM audit_log WHERE action = 'user.created' AND origin = 'bbs' AND ip_hash IS NOT DISTINCT FROM $1 AND created_at > now() - interval '1 hour'`, [ipHash]);
  if (Number(recent.rows[0]!.n) >= (ipHash ? BBS_SIGNUPS_PER_HOUR : BBS_SIGNUPS_PER_HOUR * 5)) {
    throw new ApiError(429, 'rate_limited', 'Too many new accounts from here in the last hour. Try again later.');
  }
  return accounts.signup(deps, input, { ipHash: ipHash ?? undefined } as Ctx, 'bbs');
}

// The code from the email confirms the account, and the caller is signed in straight away.
export async function confirmFromBbs(deps: AppDeps, input: { user_id: string; code: string; via: BbsVia; node: number; ip_hash?: string | null }): Promise<BbsLogin> {
  await accounts.verifyCode(deps, input.user_id, input.code, { ipHash: input.ip_hash ?? undefined } as Ctx, 'bbs');
  const u = (await deps.db.query<{ id: string; handle: string; role: string }>(`SELECT id, handle, role FROM users WHERE id = $1`, [input.user_id])).rows[0]!;
  return openSession(deps, u, input.via, input.node, input.ip_hash ?? null);
}

const refused = () => new ApiError(401, 'login_failed', 'That handle and password do not match, or this account cannot use the BBS.');

// Password or one-use web ticket: the same check IRC and the MUD use, for the 'bbs' service.
export async function loginWithSecret(deps: AppDeps, input: { handle: unknown; secret: unknown; via: BbsVia; node: number; ip_hash?: string | null }): Promise<BbsLogin> {
  const r = await checkTerminalLogin(deps, 'bbs', input.handle, input.secret);
  if (!r.ok) throw refused();
  return openSession(deps, r.user, input.via, input.node, input.ip_hash ?? null);
}

// SSH key: the BBS has already checked the signature (ssh2 does); core checks the key belongs to that handle.
export async function loginWithKey(deps: AppDeps, input: { handle: string; fingerprint: string; node: number; ip_hash?: string | null }): Promise<BbsLogin> {
  const r = await deps.db.query<{ id: string; handle: string; role: string; key_id: string }>(
    `SELECT u.id, u.handle, u.role, k.id AS key_id FROM ssh_keys k JOIN users u ON u.id = k.user_id
     WHERE k.fingerprint = $1 AND lower(u.handle) = lower($2) AND u.status = 'active' AND u.role <> 'guest'`, [input.fingerprint, input.handle]);
  const u = r.rows[0];
  if (!u) throw refused();
  await deps.db.query(`UPDATE ssh_keys SET last_used_at = now() WHERE id = $1`, [u.key_id]);
  return openSession(deps, u, 'ssh', input.node, input.ip_hash ?? null);
}

// Whether any key is registered for a handle, so the SSH server knows to offer key login first.
export async function hasKeys(deps: AppDeps, handle: string): Promise<boolean> {
  const r = await deps.db.query(`SELECT 1 FROM ssh_keys k JOIN users u ON u.id = k.user_id WHERE lower(u.handle) = lower($1) LIMIT 1`, [handle]);
  return (r.rowCount ?? 0) > 0;
}

export async function logout(deps: AppDeps, token: string, callId: string | undefined): Promise<void> {
  await deps.db.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND kind = 'bbs' AND revoked_at IS NULL`, [sha256(token)]);
  if (callId) await deps.db.query(`UPDATE bbs_calls SET disconnected_at = COALESCE(disconnected_at, now()) WHERE id = $1`, [callId]);
}

// The BBS reports every live node every few seconds. Core answers, per node, whether the caller may stay
// (their session is still valid, which it isn't once they are suspended, deleted or signed out elsewhere)
// and their current role, so the BBS can drop or update sessions within seconds (docs/04).
export async function reportNodes(deps: AppDeps, nodes: { node: number; token: string; via: BbsVia; where: string; since: string }[]) {
  const hashes = nodes.map((n) => sha256(n.token));
  const r = await deps.db.query<{ token_hash: string; user_id: string; handle: string; role: string; role_rev: number }>(
    `SELECT s.token_hash, u.id AS user_id, u.handle, u.role, u.role_rev FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ANY($1) AND s.kind = 'bbs' AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [hashes]);
  const by = new Map(r.rows.map((x) => [x.token_hash, x]));
  const live: BbsNodeState[] = [];
  const answer = nodes.map((n, i) => {
    const s = by.get(hashes[i]!);
    if (!s) return { node: n.node, ok: false as const };
    live.push({ node: n.node, user_id: s.user_id, via: n.via, where: n.where.slice(0, 60), since: n.since });
    return { node: n.node, ok: true as const, user: { id: s.user_id, handle: s.handle, role: s.role, role_rev: s.role_rev } };
  });
  setBbsNodes(live);
  return { nodes: answer };
}

// The nodes as the BBS last reported them, with handles, for the console.
export async function liveNodes(deps: AppDeps) {
  const nodes = bbsNodes();
  const r = await deps.db.query<{ id: string; handle: string }>(`SELECT id, handle FROM users WHERE id = ANY($1)`, [nodes.map((n) => n.user_id)]);
  const handles = new Map(r.rows.map((x) => [x.id, x.handle]));
  return nodes.map((n) => ({ node: n.node, handle: handles.get(n.user_id) ?? '?', via: n.via, where: n.where, since: n.since }));
}

// An admin lets someone go from the BBS: their BBS sessions end, and the BBS drops them within seconds.
export async function disconnect(deps: AppDeps, admin: SessionUser, handle: string, reason: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const u = await q.query<{ id: string }>(`SELECT id FROM users WHERE lower(handle) = lower($1)`, [handle]);
    if (!u.rows[0]) throw new ApiError(404, 'not_found', 'No such user.');
    const r = await q.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND kind = 'bbs' AND revoked_at IS NULL`, [u.rows[0].id]);
    if (!r.rowCount) throw new ApiError(409, 'not_on', `${handle} is not on the BBS.`);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'bbs.disconnected', targetType: 'user', targetId: u.rows[0].id, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function lastCallers(deps: AppDeps, limit = 20) {
  const r = await deps.db.query<{ handle: string; node: number; via: string; connected_at: Date; disconnected_at: Date | null }>(
    `SELECT u.handle, c.node, c.via, c.connected_at, c.disconnected_at FROM bbs_calls c JOIN users u ON u.id = c.user_id
     WHERE u.status = 'active' ORDER BY c.connected_at DESC LIMIT $1`, [Math.min(limit, 100)]);
  return r.rows.map((x) => ({ handle: x.handle, node: x.node, via: x.via, at: x.connected_at.toISOString(), left_at: x.disconnected_at?.toISOString() ?? null }));
}

// ---------------------------------------------------------------- SSH keys (Settings → Terminal)

const KEY_TYPES = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa'];

// "ssh-ed25519 AAAAC3… comment" → its parts and the SHA256 fingerprint OpenSSH shows (`ssh-keygen -lf`).
export function parsePublicKey(line: string): { type: string; blob: string; comment: string; fingerprint: string } {
  const bad = (m = 'That does not look like an SSH public key. Paste the whole line from your .pub file.') => new ApiError(400, 'bad_key', m);
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) throw bad();
  const [type, blob, ...rest] = parts as [string, string, ...string[]];
  if (!KEY_TYPES.includes(type)) throw bad(`Keys of type ${type.slice(0, 40)} are not supported. Use ed25519, ECDSA or RSA.`);
  if (!/^[A-Za-z0-9+/]+={0,3}$/.test(blob)) throw bad();
  const raw = Buffer.from(blob, 'base64');
  // The blob starts with its own type as a length-prefixed string; it must match the prefix.
  if (raw.length < 4) throw bad();
  const n = raw.readUInt32BE(0);
  if (n > 64 || raw.length < 4 + n || raw.subarray(4, 4 + n).toString('latin1') !== type) throw bad();
  if (type === 'ssh-rsa' && raw.length < 270) throw bad('RSA keys need at least 2048 bits.');
  const fingerprint = `SHA256:${createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')}`;
  return { type, blob, comment: rest.join(' ').slice(0, 100), fingerprint };
}

export async function listKeys(deps: AppDeps, userId: string) {
  const r = await deps.db.query<{ id: string; name: string; key_type: string; fingerprint: string; created_at: Date; last_used_at: Date | null }>(
    `SELECT id, name, key_type, fingerprint, created_at, last_used_at FROM ssh_keys WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return r.rows.map((k) => ({ id: k.id, name: k.name, type: k.key_type, fingerprint: k.fingerprint, added_at: k.created_at.toISOString(), last_used_at: k.last_used_at?.toISOString() ?? null }));
}

export const MAX_KEYS = 10;
export async function addKey(deps: AppDeps, userId: string, input: { name: string; public_key: string }, ctx: { ipHash?: string | null }) {
  const k = parsePublicKey(input.public_key);
  const name = input.name.trim() || k.comment || k.type;
  const id = newId('sk');
  await deps.db.tx(async (q) => {
    const n = Number((await q.query<{ n: string }>(`SELECT count(*) AS n FROM ssh_keys WHERE user_id = $1`, [userId])).rows[0]!.n);
    if (n >= MAX_KEYS) throw new ApiError(409, 'too_many_keys', `You can have up to ${MAX_KEYS} keys. Remove one first.`);
    try {
      await q.query(`INSERT INTO ssh_keys (id, user_id, name, key_type, public_key, fingerprint) VALUES ($1, $2, $3, $4, $5, $6)`, [id, userId, name.slice(0, 60), k.type, k.blob, k.fingerprint]);
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'ssh_keys_fingerprint_key') throw new ApiError(409, 'key_taken', 'That key is already registered.');
      throw e;
    }
    await audit(q, { actorId: userId, actorKind: 'user', action: 'ssh_key.added', targetType: 'user', targetId: userId, after: { name, fingerprint: k.fingerprint }, origin: 'web', ipHash: ctx.ipHash });
  });
  return (await listKeys(deps, userId)).find((x) => x.id === id)!;
}

export async function removeKey(deps: AppDeps, userId: string, id: string, ctx: { ipHash?: string | null }): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ fingerprint: string; name: string }>(`DELETE FROM ssh_keys WHERE id = $1 AND user_id = $2 RETURNING fingerprint, name`, [id, userId]);
    if (!r.rows[0]) throw new ApiError(404, 'not_found', 'No such key.');
    await audit(q, { actorId: userId, actorKind: 'user', action: 'ssh_key.removed', targetType: 'user', targetId: userId, before: r.rows[0], origin: 'web', ipHash: ctx.ipHash });
  });
}
