import { isReservedHandle, toPublicSite, type LoginInput, type Me, type ProfileUpdate, type SignupInput, type TerminalScheme, type ThemeName } from '@app/shared';
import { noteActive } from './activity';
import { noteWebSeen } from './presence';
import { makeT } from '@app/strings';
import { audit } from './audit';
import { randomInt } from 'node:crypto';
import { decryptSecret, encryptSecret, newId, newInviteCode, newRecoveryCode, randomToken, sha256 } from './crypto';
import { isUniqueViolation, type Queryable } from './db';
import { emit } from './events';
import { revokeOidcForUser } from './oidc/adapter';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { ensureKeypair } from './exports/keys';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords';
import { matchTotpStep, newTotpSecret, totpUri } from './totp';

const SESSION_DAYS = 30;
const VERIFY_HOURS = 24;
const INVITE_DEFAULT_DAYS = 14;
const RESET_MINUTES = 60;
const RECOVERY_CODE_COUNT = 10;

export interface Ctx { ipHash?: string | null; ip?: string; userAgent?: string }
export interface SessionUser {
  sessionId: string; userId: string; handle: string; displayName: string | null; bio: string | null; theme: ThemeName | null; theme_variant: TerminalScheme | null; email: string;
  role: 'guest' | 'user' | 'trusted' | 'admin'; emailVerified: boolean; totpEnabled: boolean; limited: boolean;
  recoveryRemaining: number; roleRev: number; ops: string[];
}

export const toMe = (u: SessionUser): Me => ({
  id: u.userId, handle: u.handle, display_name: u.displayName, bio: u.bio, theme: u.theme, theme_variant: u.theme_variant, role: u.role, email: u.email,
  email_verified: u.emailVerified, totp_enabled: u.totpEnabled, recovery_codes_remaining: u.recoveryRemaining, role_rev: u.roleRev, ops: u.ops, limited: u.limited,
});

// The ops claims for a user, e.g. ["board:b_…", "channel:#synths"] (docs/02).
export async function opsFor(q: Queryable, userId: string): Promise<string[]> {
  const r = await q.query<{ claim: string }>(
    `SELECT scope_type || ':' || scope_id AS claim FROM scoped_roles WHERE user_id = $1 ORDER BY scope_type, scope_id`, [userId]);
  return r.rows.map((x) => x.claim);
}

// Ends every live session of a user and tells the bus, so services can drop connections.
export async function revokeAllSessions(q: Queryable, userId: string, reason: string, keepSessionId?: string): Promise<number> {
  const r = await q.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2`, [userId, keepSessionId ?? null]);
  // Signing out of the site is not this: only security revocations (suspension, password reset,
  // 2FA reset) also end every service's OIDC grants and tokens.
  const grants = await revokeOidcForUser(q, userId);
  if (r.rowCount > 0 || grants > 0) await emit(q, 'session.revoked', { user_id: userId, reason });
  return r.rowCount;
}

// ---------------------------------------------------------------- signup & email verification

// A link for the browser and a six-digit code for the terminal (docs/04); either confirms the email.
interface Verification { token: string; code: string }
async function issueVerification(q: Queryable, userId: string): Promise<Verification> {
  const token = randomToken();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await q.query(
    `INSERT INTO email_verifications (token_hash, user_id, expires_at, code_hash) VALUES ($1, $2, now() + $3 * interval '1 hour', $4)`,
    [sha256(token), userId, VERIFY_HOURS, sha256(`${userId}:${code}`)],
  );
  return { token, code };
}

async function sendVerification(deps: AppDeps, user: { email: string; handle: string }, v: Verification): Promise<void> {
  const t = makeT(toPublicSite(deps.config));
  const link = `${deps.publicUrl}/verify-email?token=${encodeURIComponent(v.token)}`;
  await deps.mailer.send({ to: user.email, subject: t('email.verify.subject'), text: t('email.verify.body', { handle: user.handle, link, code: v.code }) });
}

export async function signup(deps: AppDeps, input: SignupInput, ctx: Ctx, origin: 'web' | 'bbs' = 'web'): Promise<{ id: string; handle: string }> {
  const { mode } = deps.config.signup;
  // TODO(M1 task 3, application mode): the roadmap only calls for invite mode. Application mode
  // (docs/02) needs the review queue in the admin console first.
  if (mode === 'application') throw new ApiError(501, 'not_available', 'Signing up by application is not available yet.');
  if (mode === 'invite' && !input.invite) throw new ApiError(400, 'invite_required', 'This site is invite only. Enter your invite code.');
  const minAge = deps.config.signup.minimum_age;
  if (minAge > 0 && input.age_confirmed !== true) throw new ApiError(400, 'age_required', `You need to confirm that you are at least ${minAge} to sign up.`);
  if (isReservedHandle(input.handle, deps.config.site.short_name)) {
    throw new ApiError(409, 'handle_unavailable', 'That handle is not available. Choose another.');
  }

  if (input.terminal_password !== undefined && input.terminal_password === input.password) {
    throw new ApiError(400, 'same_password', 'Use a different terminal password from the one you log in to the website with.');
  }
  const passwordHash = await hashPassword(input.password);
  const terminalHash = input.terminal_password ? await hashPassword(input.terminal_password) : null;
  const id = newId('u');

  let token: Verification;
  try {
    token = await deps.db.tx(async (q) => {
      if (mode === 'invite') {
        const inv = await q.query<{ used_by: string | null; ok: boolean }>(
          `SELECT used_by, expires_at > now() AS ok FROM invites WHERE code = $1 FOR UPDATE`, [input.invite!.toUpperCase()]);
        const row = inv.rows[0];
        // One error for unknown, used and expired so codes can't be probed.
        if (!row || row.used_by || !row.ok) throw new ApiError(400, 'invite_invalid', 'That invite code is not valid. Ask for a new one.');
      }
      // A handle someone gave up recently is held for them for 90 days, so nobody can inherit their old address.
      if ((await q.query(`SELECT 1 FROM handle_history WHERE handle = lower($1) AND changed_at > now() - interval '90 days'`, [input.handle])).rowCount > 0) {
        throw new ApiError(409, 'handle_unavailable', 'That handle is not available. Choose another.');
      }
      await q.query(
        `INSERT INTO users (id, handle, display_name, email, password_hash, age_confirmed_at, age_confirmed_min, terminal_password_hash, terminal_password_set_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END)`,
        [id, input.handle, input.display_name ?? null, input.email, passwordHash, minAge > 0 ? new Date(deps.now()) : null, minAge > 0 ? minAge : null, terminalHash]);
      await ensureKeypair(q, deps.secretKey, id); // the person's signing key, made at signup (docs/02)
      if (mode === 'invite') {
        await q.query(`UPDATE invites SET used_by = $1, used_at = now() WHERE code = $2`, [id, input.invite!.toUpperCase()]);
      }
      await audit(q, { actorId: id, actorKind: 'user', action: 'user.created', targetType: 'user', targetId: id,
        after: { handle: input.handle, role: 'guest', age_confirmed_min: minAge > 0 ? minAge : undefined, invite: mode === 'invite' ? input.invite!.toUpperCase() : undefined }, origin, ipHash: ctx.ipHash });
      await emit(q, 'user.created', { user_id: id, handle: input.handle, role: 'guest' });
      return issueVerification(q, id);
    });
  } catch (err) {
    if (isUniqueViolation(err, 'users_handle_lower')) throw new ApiError(409, 'handle_unavailable', 'That handle is not available. Choose another.');
    if (isUniqueViolation(err, 'users_email_lower')) throw new ApiError(409, 'email_taken', 'An account with that email already exists. Try logging in.');
    throw err;
  }

  // The account exists whether or not the email goes out; the user can ask for another.
  await sendVerification(deps, { email: input.email, handle: input.handle }, token).catch(() => undefined);
  return { id, handle: input.handle };
}

export async function resendVerification(deps: AppDeps, user: SessionUser): Promise<void> {
  if (user.emailVerified) throw new ApiError(409, 'already_verified', 'Your email is already confirmed.');
  const v = await issueVerification(deps.db, user.userId);
  await sendVerification(deps, { email: user.email, handle: user.handle }, v);
}

// From the terminal: a new code for a guest who lost the email (three an hour).
export async function resendVerificationTo(deps: AppDeps, userId: string): Promise<void> {
  const u = (await deps.db.query<{ email: string; handle: string; role: string; recent: string }>(
    `SELECT email, handle, role, (SELECT count(*) FROM email_verifications WHERE user_id = $1 AND expires_at > now() + interval '23 hours') AS recent FROM users WHERE id = $1 AND status = 'active'`, [userId])).rows[0];
  if (!u || u.role !== 'guest') throw new ApiError(409, 'already_verified', 'That account is already confirmed.');
  if (Number(u.recent) >= 3) throw new ApiError(429, 'rate_limited', 'We have sent a few codes already. Check your email, or wait an hour.');
  await sendVerification(deps, u, await issueVerification(deps.db, userId));
}

// The code from the email, typed in a terminal. Five wrong tries use up that code.
export async function verifyCode(deps: AppDeps, userId: string, code: string, ctx: Ctx, origin: 'web' | 'bbs' = 'bbs'): Promise<void> {
  const wrong = await deps.db.tx(async (q) => {
    const row = (await q.query<{ token_hash: string; code_hash: string; code_tries: number; ok: boolean }>(
      `SELECT token_hash, code_hash, code_tries, expires_at > now() AS ok FROM email_verifications
       WHERE user_id = $1 AND used_at IS NULL AND code_hash IS NOT NULL ORDER BY expires_at DESC LIMIT 1 FOR UPDATE`, [userId])).rows[0];
    if (!row || !row.ok || row.code_tries >= 5) throw new ApiError(400, 'code_invalid', 'That code has expired or was tried too many times. Ask for a new one.');
    if (sha256(`${userId}:${code.trim()}`) !== row.code_hash) {
      await q.query(`UPDATE email_verifications SET code_tries = code_tries + 1 WHERE token_hash = $1`, [row.token_hash]);
      return true;
    }
    await q.query(`UPDATE email_verifications SET used_at = now() WHERE token_hash = $1`, [row.token_hash]);
    await confirmEmail(q, userId, ctx, origin);
    return false;
  });
  if (wrong) throw new ApiError(400, 'code_wrong', 'That code is not right. Check the email and try again.');
}

export async function verifyEmail(deps: AppDeps, token: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const found = await q.query<{ user_id: string; used_at: string | null; ok: boolean }>(
      `SELECT user_id, used_at, expires_at > now() AS ok FROM email_verifications WHERE token_hash = $1 FOR UPDATE`, [sha256(token)]);
    const row = found.rows[0];
    if (!row || row.used_at || !row.ok) throw new ApiError(400, 'token_invalid', 'That link has expired or was already used. Request a new one.');
    await q.query(`UPDATE email_verifications SET used_at = now() WHERE token_hash = $1`, [sha256(token)]);
    await confirmEmail(q, row.user_id, ctx, 'web');
  });
}

// Confirms the email and makes a guest a user (docs/02). Anyone with a higher role keeps it.
async function confirmEmail(q: Queryable, userId: string, ctx: Ctx, origin: 'web' | 'bbs'): Promise<void> {
  const u = (await q.query<{ role: string; status: string }>(`SELECT role, status FROM users WHERE id = $1 FOR UPDATE`, [userId])).rows[0];
  if (!u || u.status !== 'active') throw new ApiError(400, 'token_invalid', 'That link has expired or was already used. Request a new one.');
  const promote = u.role === 'guest';
  const updated = await q.query<{ role_rev: number }>(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()),
            role = CASE WHEN role = 'guest' THEN 'user' ELSE role END,
            role_rev = role_rev + $2, updated_at = now() WHERE id = $1 RETURNING role_rev`, [userId, promote ? 1 : 0]);
  await audit(q, { actorId: userId, actorKind: 'user', action: 'user.email_verified', targetType: 'user', targetId: userId, origin, ipHash: ctx.ipHash });
  if (promote) {
    await audit(q, { actorKind: 'system', action: 'user.role_changed', targetType: 'user', targetId: userId,
      before: { role: 'guest' }, after: { role: 'user', reason: 'email verified' }, origin: 'system' });
    await emit(q, 'user.role_changed', { user_id: userId, role: 'user', previous_role: 'guest', role_rev: updated.rows[0]!.role_rev });
  }
}

// ---------------------------------------------------------------- login & sessions

// The second step of a login, and of anything that must be as hard to do as logging in (deleting an
// account): a current authenticator code or a recovery code, for anyone who has two-factor on.
export async function requireSecondFactor(
  deps: AppDeps, u: { id: string; totp_enabled_at: string | Date | null; totp_secret_enc: string | null }, input: { totp?: string; recovery_code?: string }, ctx: Ctx,
): Promise<void> {
  if (!u.totp_enabled_at) return;
  if (input.recovery_code) {
    await useRecoveryCode(deps, u.id, input.recovery_code, ctx);
  } else if (input.totp) {
    const result = await acceptTotp(deps, deps.db, u.id, u.totp_secret_enc!, input.totp);
    if (result === 'invalid') throw new ApiError(401, 'invalid_totp', 'That code is not right. Check the time on your device and try again.');
    if (result === 'reused') throw new ApiError(401, 'totp_reused', 'That code was already used. Wait for the next one and try again.');
  } else {
    throw new ApiError(401, 'totp_required', 'Enter the 6-digit code from your authenticator app, or a recovery code.');
  }
}

export async function login(deps: AppDeps, input: LoginInput, ctx: Ctx): Promise<{ token: string; user: Me }> {
  const bad = new ApiError(401, 'invalid_credentials', 'That handle, email or password is not right.');
  const found = await deps.db.query<{
    id: string; handle: string; display_name: string | null; bio: string | null; theme: ThemeName | null; theme_variant: TerminalScheme | null; email: string; email_verified_at: string | null; password_hash: string;
    role: SessionUser['role']; role_rev: number; status: string; totp_secret_enc: string | null; totp_enabled_at: string | null;
  }>(`SELECT * FROM users WHERE lower(handle) = lower($1) OR lower(email) = lower($1) LIMIT 1`, [input.identifier]);
  const u = found.rows[0];

  if (!u) { await burnPasswordCheck(input.password); throw bad; }
  if (!(await verifyPassword(u.password_hash, input.password))) throw bad;
  if (u.status === 'deleted') throw bad;
  if (u.status === 'suspended') throw new ApiError(403, 'suspended', 'This account is suspended. Contact the admins to appeal.');

  await requireSecondFactor(deps, u, input, ctx);

  // When the site requires it (security.require_admin_2fa, docs/02), an admin without TOTP gets a limited session until they set it up.
  const limited = deps.config.security.require_admin_2fa && u.role === 'admin' && !u.totp_enabled_at;
  const token = randomToken();
  await deps.db.tx(async (q) => {
    await q.query(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_hash, limited, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + $7 * interval '1 day')`,
      [newId('s'), u.id, sha256(token), ctx.userAgent?.slice(0, 300) ?? null, ctx.ipHash ?? null, limited, SESSION_DAYS]);
    await q.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [u.id]);
  });

  const remaining = await countRecoveryCodes(deps.db, u.id);
  const ops = await opsFor(deps.db, u.id);
  return {
    token,
    user: { id: u.id, handle: u.handle, display_name: u.display_name, bio: u.bio, theme: u.theme, theme_variant: u.theme_variant, role: u.role, email: u.email,
      email_verified: !!u.email_verified_at, totp_enabled: !!u.totp_enabled_at, recovery_codes_remaining: remaining, role_rev: u.role_rev, ops, limited },
  };
}

export async function resolveSession(deps: AppDeps, rawToken: string): Promise<SessionUser | null> {
  const r = await deps.db.query<{
    sid: string; kind: 'web' | 'bbs'; id: string; handle: string; display_name: string | null; bio: string | null; theme: ThemeName | null; theme_variant: TerminalScheme | null; email: string; role: SessionUser['role'];
    email_verified_at: string | null; totp_enabled_at: string | null; limited: boolean; recovery_remaining: number; role_rev: number; ops: string[];
  }>(
    // `limited` is worked out from the user's CURRENT role, not just the session's flag: someone
    // promoted to admin mid-session must set up TOTP before they can use any admin power.
    `SELECT s.id AS sid, s.kind, ($2::boolean AND (s.limited OR (u.role = 'admin' AND u.totp_enabled_at IS NULL))) AS limited, u.role_rev,
            COALESCE((SELECT array_agg(o.scope_type || ':' || o.scope_id ORDER BY o.scope_type, o.scope_id) FROM scoped_roles o WHERE o.user_id = u.id), '{}') AS ops,
            (SELECT count(*)::int FROM recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) AS recovery_remaining, u.id, u.handle, u.display_name, u.bio, u.theme, u.theme_variant, u.email, u.role, u.email_verified_at, u.totp_enabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'`, [sha256(rawToken), deps.config.security.require_admin_2fa]);
  const row = r.rows[0];
  if (!row) return null;
  // BBS sessions count as the BBS when it signs in (bbs/service.ts), not as web visits.
  if (!row.limited && row.kind === 'web') { noteActive(deps, row.id, 'web'); noteWebSeen(row.id); touchLastSeen(deps, row.id); }
  return { sessionId: row.sid, userId: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio, theme: row.theme, theme_variant: row.theme_variant, email: row.email, role: row.role,
    emailVerified: !!row.email_verified_at, totpEnabled: !!row.totp_enabled_at, limited: row.limited, recoveryRemaining: row.recovery_remaining, roleRev: row.role_rev, ops: row.ops };
}

// "Last seen" is for the profile's coarse "today / this week", so once every ten minutes is plenty.
const lastTouched = new Map<string, number>();
function touchLastSeen(deps: AppDeps, userId: string): void {
  const now = Date.now();
  if (now - (lastTouched.get(userId) ?? 0) < 600_000) return;
  lastTouched.set(userId, now);
  if (lastTouched.size > 100_000) lastTouched.clear();
  deps.db.query(`UPDATE users SET last_seen_at = now() WHERE id = $1`, [userId]).catch(() => lastTouched.delete(userId));
}

export async function logout(deps: AppDeps, user: SessionUser): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [user.sessionId, user.userId]);
    if (r.rowCount > 0) await emit(q, 'session.revoked', { user_id: user.userId, session_id: user.sessionId, reason: 'logout' });
  });
}

// ---------------------------------------------------------------- profile and password

// Only the fields sent are changed. An empty display name or bio clears it.
export async function updateProfile(deps: AppDeps, user: SessionUser, changes: ProfileUpdate): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [user.userId];
  const add = (column: string, value: unknown) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (changes.display_name !== undefined) add('display_name', changes.display_name || null);
  if (changes.bio !== undefined) add('bio', changes.bio || null);
  if (changes.theme !== undefined) add('theme', changes.theme);
  if (changes.theme_variant !== undefined) add('theme_variant', changes.theme_variant);
  if (changes.status_line !== undefined) add('status_line', changes.status_line || null);
  if (changes.away !== undefined) add('away', changes.away);
  if (changes.show_last_seen !== undefined) add('show_last_seen', changes.show_last_seen);
  if (changes.email_digest !== undefined) add('email_digest', changes.email_digest);
  await deps.db.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
}

// Changing your own password signs out every OTHER session and ends the grants services hold, since
// the reason to change it may be that someone else has access. This session stays signed in.
export async function changePassword(deps: AppDeps, user: SessionUser, current: string, next: string, ctx: Ctx, onError: (err: unknown) => void = () => undefined): Promise<void> {
  const r = await deps.db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [user.userId]);
  if (!(await verifyPassword(r.rows[0]!.password_hash, current))) throw new ApiError(400, 'wrong_password', 'That is not your current password.');
  if (next === current) throw new ApiError(400, 'same_password', 'Choose a password you have not used just now.');
  const hash = await hashPassword(next);
  await deps.db.tx(async (q) => {
    await q.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [user.userId, hash]);
    await revokeAllSessions(q, user.userId, 'password_changed', user.sessionId);
    await audit(q, { actorId: user.userId, actorKind: 'user', action: 'user.password_changed', targetType: 'user', targetId: user.userId, origin: 'web', ipHash: ctx.ipHash });
  });
  const t = makeT(toPublicSite(deps.config));
  void deps.mailer.send({ to: user.email, subject: t('email.passwordChanged.subject'), text: t('email.passwordChanged.body', { handle: user.handle }) }).catch(onError);
}

// ---------------------------------------------------------------- TOTP and recovery codes

type TotpResult = 'ok' | 'invalid' | 'reused';

// Checks a code and records the 30 s time step it belongs to, so the same code can't be used
// twice. The UPDATE is the atomic part: two requests with one code can't both succeed.
async function acceptTotp(deps: AppDeps, q: Queryable, userId: string, secretEnc: string, code: string): Promise<TotpResult> {
  const step = await matchTotpStep(decryptSecret(deps.secretKey, secretEnc), code, deps.now());
  if (step === null) return 'invalid';
  const r = await q.query(
    `UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`, [userId, step]);
  return r.rowCount === 1 ? 'ok' : 'reused';
}

const totpError = (result: Exclude<TotpResult, 'ok'>, status: number): ApiError =>
  result === 'reused'
    ? new ApiError(status, 'totp_reused', 'That code was already used. Wait for the next one and try again.')
    : new ApiError(status, 'invalid_totp', 'That code is not right. Check the time on your device and try again.');

async function countRecoveryCodes(q: Queryable, userId: string): Promise<number> {
  const r = await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  return r.rows[0]?.n ?? 0;
}

// Replaces any existing codes with a fresh set. Only hashes are stored; the plain codes are
// returned once and can't be shown again.
async function issueRecoveryCodes(q: Queryable, userId: string): Promise<string[]> {
  await q.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [userId]);
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  for (const code of codes) await q.query(`INSERT INTO recovery_codes (code_hash, user_id) VALUES ($1, $2)`, [sha256(code), userId]);
  return codes;
}

async function useRecoveryCode(deps: AppDeps, userId: string, code: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query(`UPDATE recovery_codes SET used_at = now() WHERE code_hash = $1 AND user_id = $2 AND used_at IS NULL`, [sha256(code), userId]);
    if (r.rowCount !== 1) throw new ApiError(401, 'invalid_recovery_code', 'That recovery code is not right, or it was already used.');
    await audit(q, { actorId: userId, actorKind: 'user', action: 'user.recovery_code_used', targetType: 'user', targetId: userId, origin: 'web', ipHash: ctx.ipHash });
  });
}

export async function totpSetup(deps: AppDeps, user: SessionUser): Promise<{ secret: string; otpauth_url: string }> {
  if (user.totpEnabled) throw new ApiError(409, 'totp_already_enabled', 'Two-factor authentication is already on.');
  const secret = newTotpSecret();
  // Stored encrypted straight away but inactive until the user proves they can produce a code.
  await deps.db.query(`UPDATE users SET totp_secret_enc = $2, totp_last_step = NULL, updated_at = now() WHERE id = $1`, [user.userId, encryptSecret(deps.secretKey, secret)]);
  return { secret, otpauth_url: totpUri(deps.config.site.name, user.handle, secret) };
}

// Returns the recovery codes. This is the only time they are shown.
export async function totpEnable(deps: AppDeps, user: SessionUser, code: string, ctx: Ctx): Promise<string[]> {
  if (user.totpEnabled) throw new ApiError(409, 'totp_already_enabled', 'Two-factor authentication is already on.');
  const r = await deps.db.query<{ totp_secret_enc: string | null }>(`SELECT totp_secret_enc FROM users WHERE id = $1`, [user.userId]);
  const enc = r.rows[0]?.totp_secret_enc;
  if (!enc) throw new ApiError(400, 'totp_not_started', 'Start two-factor setup first.');
  return deps.db.tx(async (q) => {
    const result = await acceptTotp(deps, q, user.userId, enc, code);
    if (result !== 'ok') throw totpError(result, 400);
    await q.query(`UPDATE users SET totp_enabled_at = now(), updated_at = now() WHERE id = $1`, [user.userId]);
    await q.query(`UPDATE sessions SET limited = false WHERE user_id = $1 AND revoked_at IS NULL`, [user.userId]);
    const codes = await issueRecoveryCodes(q, user.userId);
    await audit(q, { actorId: user.userId, actorKind: 'user', action: 'user.totp_enabled', targetType: 'user', targetId: user.userId, origin: 'web', ipHash: ctx.ipHash });
    return codes;
  });
}

// Needs a current authenticator code, so a stolen session alone can't mint new recovery codes.
export async function regenerateRecoveryCodes(deps: AppDeps, user: SessionUser, code: string, ctx: Ctx): Promise<string[]> {
  if (!user.totpEnabled) throw new ApiError(400, 'totp_not_enabled', 'Turn on two-factor authentication first.');
  const r = await deps.db.query<{ totp_secret_enc: string }>(`SELECT totp_secret_enc FROM users WHERE id = $1`, [user.userId]);
  return deps.db.tx(async (q) => {
    const result = await acceptTotp(deps, q, user.userId, r.rows[0]!.totp_secret_enc, code);
    if (result !== 'ok') throw totpError(result, 400);
    const codes = await issueRecoveryCodes(q, user.userId);
    await audit(q, { actorId: user.userId, actorKind: 'user', action: 'user.recovery_codes_regenerated', targetType: 'user', targetId: user.userId, origin: 'web', ipHash: ctx.ipHash });
    return codes;
  });
}

// ---------------------------------------------------------------- password reset

// Always returns quietly, whether or not the email belongs to an account, so this can't be used
// to find out who is registered. Mail is sent in the background for the same reason: sending
// takes time only when the account exists.
export async function forgotPassword(deps: AppDeps, email: string, ctx: Ctx, onError: (err: unknown) => void = () => undefined): Promise<void> {
  const found = await deps.db.query<{ id: string; handle: string; email: string }>(
    `SELECT id, handle, email FROM users WHERE lower(email) = lower($1) AND status <> 'deleted'`, [email]);
  const u = found.rows[0];
  if (!u) return;
  const token = randomToken();
  await deps.db.tx(async (q) => {
    // Only the newest link works.
    await q.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [u.id]);
    await q.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 minute')`, [sha256(token), u.id, RESET_MINUTES]);
    await audit(q, { actorKind: 'system', action: 'user.password_reset_requested', targetType: 'user', targetId: u.id, origin: 'web', ipHash: ctx.ipHash });
  });
  const t = makeT(toPublicSite(deps.config));
  const link = `${deps.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  void deps.mailer.send({ to: u.email, subject: t('email.reset.subject'), text: t('email.reset.body', { handle: u.handle, link }) }).catch(onError);
}

export async function resetPassword(deps: AppDeps, token: string, password: string, ctx: Ctx, onError: (err: unknown) => void = () => undefined): Promise<void> {
  const passwordHash = await hashPassword(password);
  const user = await deps.db.tx(async (q) => {
    const found = await q.query<{ user_id: string; used_at: string | null; ok: boolean }>(
      `SELECT user_id, used_at, expires_at > now() AS ok FROM password_resets WHERE token_hash = $1 FOR UPDATE`, [sha256(token)]);
    const row = found.rows[0];
    if (!row || row.used_at || !row.ok) throw new ApiError(400, 'token_invalid', 'That link has expired or was already used. Request a new one.');
    const u = await q.query<{ handle: string; email: string; status: string }>(`SELECT handle, email, status FROM users WHERE id = $1 FOR UPDATE`, [row.user_id]);
    const account = u.rows[0];
    if (!account || account.status === 'deleted') throw new ApiError(400, 'token_invalid', 'That link has expired or was already used. Request a new one.');

    await q.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [row.user_id, passwordHash]);
    await q.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [row.user_id]);
    // Whoever had the old password, or a stolen session, is signed out.
    await revokeAllSessions(q, row.user_id, 'password_reset');
    await audit(q, { actorId: row.user_id, actorKind: 'user', action: 'user.password_reset', targetType: 'user', targetId: row.user_id, origin: 'web', ipHash: ctx.ipHash });
    return account;
  });
  const t = makeT(toPublicSite(deps.config));
  void deps.mailer.send({ to: user.email, subject: t('email.passwordChanged.subject'), text: t('email.passwordChanged.body', { handle: user.handle }) }).catch(onError);
}

// ---------------------------------------------------------------- admin

export async function createInvite(deps: AppDeps, admin: SessionUser, days: number | undefined, ctx: Ctx): Promise<{ code: string; expires_at: string }> {
  const code = newInviteCode();
  const r = await deps.db.tx(async (q) => {
    const ins = await q.query<{ expires_at: string }>(
      `INSERT INTO invites (code, created_by, expires_at) VALUES ($1, $2, now() + $3 * interval '1 day') RETURNING expires_at`,
      [code, admin.userId, days ?? INVITE_DEFAULT_DAYS]);
    await audit(q, { actorId: admin.userId, actorKind: 'user', action: 'invite.created', targetType: 'invite', targetId: code, origin: 'web', ipHash: ctx.ipHash });
    return ins.rows[0]!;
  });
  return { code, expires_at: new Date(r.expires_at).toISOString() };
}

// Operator commands (run on the server, see cli.ts). They audit as actor_kind 'cli'.
export async function createAdmin(deps: AppDeps, input: { handle: string; email: string; password: string }): Promise<string> {
  const id = newId('u');
  const passwordHash = await hashPassword(input.password);
  await deps.db.tx(async (q) => {
    await q.query(
      `INSERT INTO users (id, handle, email, email_verified_at, password_hash, role, role_rev) VALUES ($1, $2, $3, now(), $4, 'admin', 1)`,
      [id, input.handle, input.email, passwordHash]);
    await audit(q, { actorKind: 'cli', action: 'user.created', targetType: 'user', targetId: id, after: { handle: input.handle, role: 'admin' }, origin: 'cli' });
    await emit(q, 'user.created', { user_id: id, handle: input.handle, role: 'admin' });
  });
  return id;
}

export async function resetTotp(deps: AppDeps, handle: string): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ id: string }>(`UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = now() WHERE lower(handle) = lower($1) RETURNING id`, [handle]);
    const id = r.rows[0]?.id;
    if (!id) throw new ApiError(404, 'not_found', `No user with handle ${handle}.`);
    await q.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [id]);
    await revokeAllSessions(q, id, 'totp_reset');
    await audit(q, { actorKind: 'cli', action: 'user.totp_reset', targetType: 'user', targetId: id, origin: 'cli' });
  });
}
