import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import type { SiteConfig } from '@app/shared';

// Where the Gemini mirror's TLS certificate comes from (docs/05, docs/19; decided 2026-10-05).
// - self-signed (the default, and the Gemini custom): made once and kept in GEMINI_DATA_DIR. Gemini clients remember a
//   site's certificate on the first visit and warn if it changes, so it is made to last 20 years and never replaced.
// - site: the site's own certificate, which Caddy keeps renewed. Its paths come from GEMINI_TLS_CERT and GEMINI_TLS_KEY
//   (compose.prod points them into Caddy's store), and the server reloads it when it changes.
// GEMINI_TLS_CERT and GEMINI_TLS_KEY, when set, win either way.

export interface GeminiCert { cert: string; key: string; fingerprint: string; source: 'self-signed' | 'site' | 'given'; certPath?: string }

// "SHA256:AB:CD:…", what people compare against the fingerprint their client shows.
export const fingerprintOf = (certPem: string): string => `SHA256:${new X509Certificate(certPem).fingerprint256}`;

export async function loadGeminiCert(config: SiteConfig, env: NodeJS.ProcessEnv = process.env): Promise<GeminiCert> {
  if (env.GEMINI_TLS_CERT && env.GEMINI_TLS_KEY) {
    const cert = readFileSync(env.GEMINI_TLS_CERT, 'utf8');
    return { cert, key: readFileSync(env.GEMINI_TLS_KEY, 'utf8'), fingerprint: fingerprintOf(cert), source: config.gemini.certificate === 'site' ? 'site' : 'given', certPath: env.GEMINI_TLS_CERT };
  }
  if (config.gemini.certificate === 'site') throw new Error('gemini.certificate is "site" but GEMINI_TLS_CERT and GEMINI_TLS_KEY are not set (docs/19)');
  const dir = env.GEMINI_DATA_DIR ?? './data/gemini';
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    const host = config.gemini.host ?? config.site.domain;
    const now = new Date();
    const made = await generate([{ name: 'commonName', value: host }], {
      keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notBeforeDate: now, notAfterDate: new Date(now.getTime() + 20 * 365 * 86_400_000),
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: host }] }],
    });
    mkdirSync(dir, { recursive: true });
    writeFileSync(keyPath, made.private, { mode: 0o600 });
    chmodSync(keyPath, 0o600);
    writeFileSync(certPath, made.cert);
  }
  const cert = readFileSync(certPath, 'utf8');
  return { cert, key: readFileSync(keyPath, 'utf8'), fingerprint: fingerprintOf(cert), source: 'self-signed', certPath };
}
