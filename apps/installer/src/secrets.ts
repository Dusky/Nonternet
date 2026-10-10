import { createECDH, randomBytes } from 'node:crypto';

// The site's own secrets, made the way docs/19 says to make them by hand. A source of random bytes can be passed in, so
// tests get the same output every time.
export type Random = (n: number) => Buffer;
export const systemRandom: Random = (n) => randomBytes(n);

export const hex = (r: Random, bytes: number) => r(bytes).toString('hex');                       // database passwords go in URLs
export const b64 = (r: Random, bytes: number) => r(bytes).toString('base64');                    // APP_SECRET_KEY, BACKUP_KEY, …
export const b64url = (r: Random, bytes: number) => r(bytes).toString('base64url');              // the setup link's token

// A VAPID key pair for push (P-256), in the base64url form web-push and browsers expect.
export function vapidKeys(r: Random): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  let priv = r(32);
  // A private key must be below the curve order; the chance of a random one not being is about 1 in 2^32.
  for (let i = 0; i < 4; i++) { try { ecdh.setPrivateKey(priv); break; } catch { priv = randomBytes(32); } }
  return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: ecdh.getPrivateKey().toString('base64url') };
}
