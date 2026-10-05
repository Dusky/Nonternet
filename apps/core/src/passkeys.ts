import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransport, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { toPublicSite, type Me } from '@app/shared';
import { makeT } from '@app/strings';
import { checkPassword, openSession, type Ctx, type LoginRow, type SessionUser } from './accounts';
import { audit } from './audit';
import { newId, randomToken } from './crypto';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { passkeySite } from './passkey-site';

// Passkeys (docs/02, decided 2026-10-05). A passkey proves both that you hold the device and, with its PIN or
// fingerprint, that you are you, so signing in with one skips the password and the two-factor code. Adding one
// needs your password, so a session someone else picked up can't quietly add its own way back in.

const CHALLENGE_MINUTES = 5;
export const MAX_PASSKEYS = 20;

export interface PasskeyView { id: string; name: string; created_at: string; last_used_at: string | null; backed_up: boolean }

export async function listPasskeys(deps: AppDeps, userId: string): Promise<PasskeyView[]> {
  const r = await deps.db.query<{ id: string; name: string; created_at: Date; last_used_at: Date | null; backed_up: boolean }>(
    `SELECT id, name, created_at, last_used_at, backed_up FROM webauthn_credentials WHERE user_id = $1 ORDER BY created_at`, [userId]);
  return r.rows.map((p) => ({ id: p.id, name: p.name, created_at: p.created_at.toISOString(), last_used_at: p.last_used_at?.toISOString() ?? null, backed_up: p.backed_up }));
}

async function saveChallenge(deps: AppDeps, purpose: 'register' | 'login', challenge: string, userId: string | null): Promise<string> {
  const id = randomToken(18);
  await deps.db.query(`DELETE FROM webauthn_challenges WHERE expires_at < now()`);
  await deps.db.query(`INSERT INTO webauthn_challenges (id, user_id, purpose, challenge, expires_at) VALUES ($1, $2, $3, $4, now() + $5 * interval '1 minute')`,
    [id, userId, purpose, challenge, CHALLENGE_MINUTES]);
  return id;
}

// Used once: taking it deletes it, so an answer can't be replayed.
async function takeChallenge(deps: AppDeps, id: string, purpose: 'register' | 'login', userId: string | null): Promise<string> {
  const r = await deps.db.query<{ challenge: string }>(
    `DELETE FROM webauthn_challenges WHERE id = $1 AND purpose = $2 AND user_id IS NOT DISTINCT FROM $3 AND expires_at > now() RETURNING challenge`, [id, purpose, userId]);
  if (!r.rows[0]) throw new ApiError(400, 'passkey_expired', 'That took too long. Try again.');
  return r.rows[0].challenge;
}

// Step one of adding a passkey: check the password, then ask the browser to make a key for this site.
export async function registrationOptions(deps: AppDeps, user: SessionUser, password: string) {
  await checkPassword(deps, user.userId, password);
  const existing = (await deps.db.query<{ credential_id: string; transports: string[] }>(
    `SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1`, [user.userId])).rows;
  if (existing.length >= MAX_PASSKEYS) throw new ApiError(409, 'too_many_passkeys', `You have ${MAX_PASSKEYS} passkeys, the most there can be. Remove one you no longer use first.`);
  const { rpID } = passkeySite(deps.publicUrl);
  const options = await generateRegistrationOptions({
    rpName: deps.config.site.name,
    rpID,
    userName: user.handle,
    userDisplayName: user.displayName ?? user.handle,
    userID: new TextEncoder().encode(user.userId), // the stable id, so a rename doesn't orphan the passkey
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { challenge_id: await saveChallenge(deps, 'register', options.challenge, user.userId), options };
}

// Step two: check what the browser made and keep its public key.
export async function finishRegistration(deps: AppDeps, user: SessionUser, input: { challenge_id: string; name: string; response: unknown }, ctx: Ctx): Promise<PasskeyView> {
  const expected = await takeChallenge(deps, input.challenge_id, 'register', user.userId);
  const { rpID, origin } = passkeySite(deps.publicUrl);
  const failed = new ApiError(400, 'passkey_failed', 'That passkey could not be added. Try again, or use another device.');
  let info;
  try {
    const v = await verifyRegistrationResponse({ response: input.response as RegistrationResponseJSON, expectedChallenge: expected, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
    if (!v.verified) throw failed;
    info = v.registrationInfo;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw failed;
  }
  const id = newId('pk');
  const name = input.name.trim() || 'Passkey';
  const created = await deps.db.tx(async (q) => {
    const count = Number((await q.query<{ n: string }>(`SELECT count(*) AS n FROM webauthn_credentials WHERE user_id = $1`, [user.userId])).rows[0]!.n);
    if (count >= MAX_PASSKEYS) throw new ApiError(409, 'too_many_passkeys', `You have ${MAX_PASSKEYS} passkeys, the most there can be. Remove one you no longer use first.`);
    const r = await q.query<{ created_at: Date }>(
      `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, backed_up, name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (credential_id) DO NOTHING RETURNING created_at`,
      [id, user.userId, info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter, info.credential.transports ?? [], info.credentialBackedUp, name]);
    if (!r.rows[0]) throw new ApiError(409, 'passkey_exists', 'That passkey is already on an account here.');
    await audit(q, { actorId: user.userId, actorKind: 'user', action: 'user.passkey_added', targetType: 'user', targetId: user.userId, after: { passkey: id, name }, origin: 'web', ipHash: ctx.ipHash });
    return r.rows[0].created_at;
  });
  // Like a password change, a new way into the account is worth an email: if it wasn't them, they'll know.
  const t = makeT(toPublicSite(deps.config));
  void deps.mailer.send({ to: user.email, subject: t('email.passkeyAdded.subject'), text: t('email.passkeyAdded.body', { handle: user.handle, name }) }).catch(() => undefined);
  return { id, name, created_at: created.toISOString(), last_used_at: null, backed_up: info.credentialBackedUp };
}

export async function renamePasskey(deps: AppDeps, user: SessionUser, id: string, name: string): Promise<void> {
  const r = await deps.db.query(`UPDATE webauthn_credentials SET name = $3 WHERE id = $1 AND user_id = $2`, [id, user.userId, name.trim() || 'Passkey']);
  if (r.rowCount === 0) throw new ApiError(404, 'not_found', 'That passkey is not on your account.');
}

export async function removePasskey(deps: AppDeps, user: SessionUser, id: string, ctx: Ctx): Promise<void> {
  await deps.db.tx(async (q) => {
    const r = await q.query<{ name: string }>(`DELETE FROM webauthn_credentials WHERE id = $1 AND user_id = $2 RETURNING name`, [id, user.userId]);
    if (!r.rows[0]) throw new ApiError(404, 'not_found', 'That passkey is not on your account.');
    await audit(q, { actorId: user.userId, actorKind: 'user', action: 'user.passkey_removed', targetType: 'user', targetId: user.userId, before: { passkey: id, name: r.rows[0].name }, origin: 'web', ipHash: ctx.ipHash });
  });
}

// Signing in, step one: no handle is asked for. The browser offers whichever passkeys it has for this site.
export async function loginOptions(deps: AppDeps) {
  const { rpID } = passkeySite(deps.publicUrl);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  return { challenge_id: await saveChallenge(deps, 'login', options.challenge, null), options };
}

// Step two: find whose passkey answered, check the signature, and open a session.
export async function finishLogin(deps: AppDeps, input: { challenge_id: string; response: unknown }, ctx: Ctx): Promise<{ token: string; user: Me }> {
  const expected = await takeChallenge(deps, input.challenge_id, 'login', null);
  const response = input.response as AuthenticationResponseJSON;
  const unknown = new ApiError(401, 'passkey_unknown', 'That passkey is not on any account here. Log in with your password, then add it in Settings.');
  if (!response || typeof response.id !== 'string') throw unknown;
  const found = await deps.db.query<LoginRow & { pk_id: string; pk_public_key: Buffer; pk_counter: string; pk_transports: string[]; status: string; pk_credential_id: string }>(
    `SELECT u.*, c.id AS pk_id, c.credential_id AS pk_credential_id, c.public_key AS pk_public_key, c.counter AS pk_counter, c.transports AS pk_transports FROM webauthn_credentials c JOIN users u ON u.id = c.user_id WHERE c.credential_id = $1`, [response.id]);
  const row = found.rows[0];
  if (!row || row.status === 'deleted') throw unknown;
  if (row.status === 'suspended') throw new ApiError(403, 'suspended', 'This account is suspended. Contact the admins to appeal.');
  const { rpID, origin } = passkeySite(deps.publicUrl);
  let newCounter: number;
  try {
    const v = await verifyAuthenticationResponse({
      response, expectedChallenge: expected, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: row.pk_credential_id, publicKey: new Uint8Array(row.pk_public_key), counter: Number(row.pk_counter), transports: row.pk_transports as AuthenticatorTransport[] },
    });
    if (!v.verified) throw new Error('not verified');
    newCounter = v.authenticationInfo.newCounter;
  } catch {
    throw new ApiError(401, 'passkey_failed', 'That passkey did not work. Try again, or log in with your password.');
  }
  await deps.db.query(`UPDATE webauthn_credentials SET counter = $2, last_used_at = now() WHERE id = $1`, [row.pk_id, newCounter]);
  return openSession(deps, row, ctx);
}
