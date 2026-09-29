import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { JWK } from 'jose';
import { decryptSecret, encryptSecret } from '../crypto';
import type { Db } from '../db';

// Signing keys (ES256). Created once and kept in the database, encrypted with APP_SECRET_KEY, so
// every core instance signs with the same key and tokens survive restarts. Rotation: add a newer
// row; the newest signs, older ones stay published so their tokens still verify. (A rotate command
// is not built yet.)
export async function loadOrCreateKeys(db: Db, secretKey: Buffer): Promise<JWK[]> {
  const read = async () =>
    (await db.query<{ private_jwk_enc: string }>(`SELECT private_jwk_enc FROM oidc_keys ORDER BY created_at DESC, kid`)).rows.map((r) => {
      try {
        return JSON.parse(decryptSecret(secretKey, r.private_jwk_enc)) as JWK;
      } catch {
        // AES-GCM fails like this when the key is wrong. Say so, instead of a cryptic crypto error.
        throw new Error('Cannot read the OIDC signing keys: APP_SECRET_KEY is not the key they were encrypted with. Restore the original APP_SECRET_KEY.');
      }
    });

  const existing = await read();
  if (existing.length > 0) return existing;

  // Two instances starting together must not each create a key: the lock serialises them.
  await db.tx(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(724002)');
    const again = await q.query(`SELECT 1 FROM oidc_keys LIMIT 1`);
    if (again.rowCount > 0) return;
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const kid = `k_${randomBytes(9).toString('base64url')}`;
    const jwk = { ...privateKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
    await q.query(`INSERT INTO oidc_keys (kid, alg, private_jwk_enc) VALUES ($1, 'ES256', $2)`, [kid, encryptSecret(secretKey, JSON.stringify(jwk))]);
  });
  return read();
}
