import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { ulid } from 'ulid';

// Stable prefixed IDs (docs/13): u_ users, s_ sessions.
export const newId = (prefix: string): string => `${prefix}_${ulid()}`;

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

// Human-friendly invite code, e.g. K7QF-M2XD-9WPA (no look-alike characters).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newInviteCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
}

// Recovery code, e.g. k3m9x-2qf7a: 10 characters, lower case, no i, l or o (matches RECOVERY_CODE_PATTERN
// in @app/shared). randomInt is unbiased.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newRecoveryCode(): string {
  const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

// Secrets at rest (TOTP) use AES-256-GCM with APP_SECRET_KEY: 32 bytes, base64 (docs/15).
export function parseSecretKey(value: string | undefined): Buffer {
  if (!value) throw new Error('APP_SECRET_KEY is required: 32 random bytes, base64 (openssl rand -base64 32)');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('APP_SECRET_KEY must decode to exactly 32 bytes');
  return key;
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decryptSecret(key: Buffer, stored: string): string {
  const [version, iv, tag, body] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unrecognised secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

// IP addresses are only ever stored hashed (docs/15), keyed so the hash can't be reversed by
// brute-forcing the small IPv4 space.
export const hashIp = (key: Buffer, ip: string): string => createHash('sha256').update(key).update(ip).digest('hex');
