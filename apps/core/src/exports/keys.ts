import { createCipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scryptSync, sign } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../crypto';
import type { Queryable } from '../db';

// Each person has an Ed25519 key (docs/02, docs/12). The site holds the private half, encrypted with
// APP_SECRET_KEY, and uses it to sign that person's exports. The public half goes in every export.
export async function ensureKeypair(q: Queryable, secretKey: Buffer, userId: string): Promise<{ publicPem: string }> {
  const r = await q.query<{ public_key: string | null }>(`SELECT public_key FROM users WHERE id = $1 FOR UPDATE`, [userId]);
  if (r.rows[0]?.public_key) return { publicPem: r.rows[0].public_key };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  await q.query(`UPDATE users SET public_key = $2, private_key_enc = $3 WHERE id = $1`, [userId, publicPem, encryptSecret(secretKey, privatePem)]);
  return { publicPem };
}

async function privatePem(q: Queryable, secretKey: Buffer, userId: string): Promise<string> {
  const r = await q.query<{ private_key_enc: string | null }>(`SELECT private_key_enc FROM users WHERE id = $1`, [userId]);
  if (!r.rows[0]?.private_key_enc) throw new Error('no private key');
  return decryptSecret(secretKey, r.rows[0].private_key_enc);
}

export async function signData(q: Queryable, secretKey: Buffer, userId: string, data: Buffer): Promise<string> {
  return sign(null, data, createPrivateKey(await privatePem(q, secretKey, userId))).toString('base64');
}

// The person's private key, locked with a password they choose, so they can keep it (docs/12). The
// format is plain JSON so it can be opened with any tool: scrypt makes the key, AES-256-GCM locks it.
export async function lockedPrivateKey(q: Queryable, secretKey: Buffer, userId: string, password: string): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const params = { N: 2 ** 15, r: 8, p: 1 };
  const key = scryptSync(password, salt, 32, { ...params, maxmem: 128 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(await privatePem(q, secretKey, userId), 'utf8'), cipher.final()]);
  return JSON.stringify({ format: 'private-key-v1', kdf: 'scrypt', ...params, salt: salt.toString('base64'), cipher: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ct.toString('base64') }, null, 2);
}

export const publicKeyFingerprint = (pem: string): string => createPublicKey(pem).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
