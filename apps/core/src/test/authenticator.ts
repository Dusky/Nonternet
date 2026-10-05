import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// A software passkey for the tests: it makes and signs WebAuthn answers the way a phone or a security key does
// (ES256, "none" attestation), so core's real verification runs with nothing mocked.

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor> | { [k: string]: Cbor };
function cbor(v: Cbor): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, s.length), s]); }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
const sha = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();
const UP = 0x01, UV = 0x04, AT = 0x40;

export class TestAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly key: KeyObject;
  private readonly cose: Buffer;
  private counter = 0;
  userHandle = '';

  constructor(private readonly origin: string, private readonly rpID: string, private readonly verifyUser = true) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
  }

  get id(): string { return b64u(this.credentialId); }

  private authData(attested: boolean): Buffer {
    const flags = UP | (this.verifyUser ? UV : 0) | (attested ? AT : 0);
    const count = Buffer.alloc(4); count.writeUInt32BE(this.counter);
    const parts = [sha(this.rpID), Buffer.from([flags]), count];
    if (attested) {
      const len = Buffer.alloc(2); len.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), len, this.credentialId, this.cose);
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** The answer to registration options (`options.challenge`, `options.user.id`). */
  register(options: { challenge: string; user: { id: string } }) {
    this.userHandle = options.user.id;
    const attestationObject = cbor({ fmt: 'none', attStmt: {}, authData: this.authData(true) });
    return {
      id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(this.clientData('webauthn.create', options.challenge)), attestationObject: b64u(attestationObject), transports: ['internal'] },
    };
  }

  /** The answer to sign-in options. `origin` can be changed to play a look-alike site. */
  authenticate(options: { challenge: string }, opts: { origin?: string } = {}) {
    this.counter += 1;
    const authenticatorData = this.authData(false);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, opts.origin);
    const signature = sign('sha256', Buffer.concat([authenticatorData, sha(clientDataJSON)]), this.key);
    return {
      id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authenticatorData), signature: b64u(signature), userHandle: this.userHandle },
    };
  }
}
