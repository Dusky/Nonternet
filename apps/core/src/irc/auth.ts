import { audit } from '../audit';
import { noteActive } from '../activity';
import { randomToken, sha256 } from '../crypto';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../passwords';
import type { Ctx, SessionUser } from '../accounts';

const TICKET_PREFIX = 'tk1_';
const TICKET_TTL_MS = 60_000;

export type TerminalService = 'irc' | 'mud' | 'bbs';
export interface AuthResult { success: boolean; accountName?: string; error?: string }
export interface LoginUser { id: string; handle: string; role: string }

// How IRC and the MUD sign people in (docs/02, 08, 09): the password is either the person's terminal
// password or a one-use ticket their browser got from core a moment ago for that service. Only active
// users with a confirmed email may use them (Q4, decided 2026-09-30).
export async function checkTerminalLogin(deps: AppDeps, service: TerminalService, accountName: unknown, passphrase: unknown): Promise<{ ok: true; user: LoginUser } | { ok: false; error: string }> {
  if (typeof accountName !== 'string' || typeof passphrase !== 'string' || !accountName || !passphrase || accountName.length > 40 || passphrase.length > 200) {
    return { ok: false, error: 'missing name or password' };
  }
  const r = await deps.db.query<{ id: string; handle: string; role: string; status: string; terminal_password_hash: string | null }>(
    `SELECT id, handle, role, status, terminal_password_hash FROM users WHERE lower(handle) = lower($1)`, [accountName]);
  const u = r.rows[0];
  if (!u || u.status !== 'active' || u.role === 'guest') {
    await burnPasswordCheck(passphrase); // the same time either way, so accounts can't be probed
    return { ok: false, error: u ? `account may not use ${service}` : 'no such account' };
  }
  if (passphrase.startsWith(TICKET_PREFIX)) {
    const used = await deps.db.query(
      `UPDATE terminal_tickets SET used_at = now() WHERE token_hash = $1 AND user_id = $2 AND service = $4 AND used_at IS NULL AND expires_at > to_timestamp($3 / 1000.0)`,
      [sha256(passphrase), u.id, deps.now(), service]);
    if (used.rowCount) noteActive(deps, u.id, service);
    return used.rowCount ? { ok: true, user: u } : { ok: false, error: 'ticket not valid' };
  }
  if (!u.terminal_password_hash) {
    await burnPasswordCheck(passphrase);
    return { ok: false, error: 'no terminal password set' };
  }
  if (!(await verifyPassword(u.terminal_password_hash, passphrase))) return { ok: false, error: 'wrong password' };
  noteActive(deps, u.id, service);
  return { ok: true, user: u };
}

// Ergo's auth-script answer (docs/08).
export async function checkIrcLogin(deps: AppDeps, accountName: unknown, passphrase: unknown): Promise<AuthResult> {
  const r = await checkTerminalLogin(deps, 'irc', accountName, passphrase);
  return r.ok ? { success: true, accountName: r.user.handle } : { success: false, error: r.error };
}

export async function issueTicket(deps: AppDeps, user: SessionUser, service: TerminalService = 'irc'): Promise<{ ticket: string; nick: string; expires_in: number }> {
  if (service === 'irc' && !deps.irc) throw new ApiError(503, 'irc_off', 'Chat is not set up on this site yet.');
  if (service === 'mud' && !deps.mud) throw new ApiError(503, 'mud_off', 'The MUD is not set up on this site yet.');
  if (service === 'bbs' && !deps.bbs) throw new ApiError(503, 'bbs_off', 'The BBS is not set up on this site yet.');
  if (user.role === 'guest') throw new ApiError(403, 'email_unconfirmed', service === 'irc' ? 'Confirm your email address to use chat.' : service === 'mud' ? 'Confirm your email address to play the MUD.' : 'Confirm your email address to use the BBS.');
  const ticket = `${TICKET_PREFIX}${randomToken()}`;
  await deps.db.query(`DELETE FROM terminal_tickets WHERE expires_at < now() - interval '1 hour'`);
  await deps.db.query(`INSERT INTO terminal_tickets (token_hash, user_id, expires_at, service) VALUES ($1, $2, to_timestamp($3 / 1000.0), $4)`, [sha256(ticket), user.userId, deps.now() + TICKET_TTL_MS, service]);
  return { ticket, nick: user.handle, expires_in: TICKET_TTL_MS / 1000 };
}

// ---------------------------------------------------------------- terminal password (docs/02)

export async function terminalPasswordState(deps: AppDeps, userId: string): Promise<{ set: boolean; set_at: string | null }> {
  const r = await deps.db.query<{ at: Date | null }>(`SELECT terminal_password_set_at AS at FROM users WHERE id = $1`, [userId]);
  const at = r.rows[0]?.at ?? null;
  return { set: at !== null, set_at: at ? at.toISOString() : null };
}

async function checkWebPassword(deps: AppDeps, userId: string, password: string): Promise<void> {
  const r = await deps.db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (!r.rows[0] || !(await verifyPassword(r.rows[0].password_hash, password))) {
    throw new ApiError(400, 'wrong_password', 'That is not your current password.');
  }
}

export async function setTerminalPassword(deps: AppDeps, user: SessionUser, password: string, terminal: string, ctx: Ctx): Promise<void> {
  await checkWebPassword(deps, user.userId, password);
  if (terminal === password) throw new ApiError(400, 'same_password', 'Use a different password from the one you log in to the website with.');
  const hash = await hashPassword(terminal);
  await deps.db.tx(async (q) => {
    await q.query(`UPDATE users SET terminal_password_hash = $2, terminal_password_set_at = now() WHERE id = $1`, [user.userId, hash]);
    await audit(q, { actorId: user.userId, actorKind: 'user', action: 'user.terminal_password_set', targetType: 'user', targetId: user.userId, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function clearTerminalPassword(deps: AppDeps, actor: SessionUser, userId: string, ctx: Ctx, opts: { password?: string; reason?: string }): Promise<void> {
  if (actor.userId === userId) await checkWebPassword(deps, userId, opts.password ?? '');
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE users SET terminal_password_hash = NULL, terminal_password_set_at = NULL WHERE id = $1 AND terminal_password_hash IS NOT NULL`, [userId]);
    if (r.rowCount === 0) throw new ApiError(409, 'not_set', 'There is no terminal password to remove.');
    await audit(q, { actorId: actor.userId, actorKind: 'user', action: 'user.terminal_password_cleared', targetType: 'user', targetId: userId, after: opts.reason ? { reason: opts.reason } : undefined, origin: 'web', ipHash: ctx.ipHash });
  });
}
