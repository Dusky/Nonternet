import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import ssh2 from 'ssh2';

// The SSH host key: made once and kept, so callers' clients recognise the BBS next time.
export function hostKey(file: string): Buffer {
  if (existsSync(file)) return readFileSync(file);
  const { private: key } = ssh2.utils.generateKeyPairSync('ed25519');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key, { mode: 0o600 });
  return Buffer.from(key);
}
