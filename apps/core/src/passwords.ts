import { hash, verify } from '@node-rs/argon2';

// argon2id (Algorithm.Argon2id = 2) with the library's recommended cost parameters.
const ARGON2ID = 2;
const options = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, options);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Verifying against this when a user doesn't exist keeps login timing the same either way.
let dummy: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummy, password);
}
