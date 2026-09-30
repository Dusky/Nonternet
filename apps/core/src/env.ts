import { promises as dns } from 'node:dns';
import { resolve } from 'node:path';
import { parseSecretKey } from './crypto';
import { loadSiteConfig } from './config';
import { connect } from './db';
import type { AppDeps } from './deps';
import { HomeStore } from './homes/files';
import { makeMailer } from './mailer';
import { resolveOidcClients } from './oidc/provider';

// Rate limits are on unless RATE_LIMIT=off, which exists for automated tests that sign up more people
// than one address is allowed to. It refuses to run in production, where turning them off is never
// what anyone means.
function rateLimitEnabled(env: Record<string, string | undefined>, production: boolean): boolean {
  if (env.RATE_LIMIT !== 'off') return true;
  if (production) throw new Error('RATE_LIMIT=off is not allowed when NODE_ENV=production');
  return false;
}

// Everything core needs from its environment, in one place.
//   SITE_CONFIG      path to the site config (required)
//   DATABASE_URL     Postgres connection string (required)
//   APP_SECRET_KEY   32 random bytes, base64 (required)
//   PUBLIC_URL       base of emailed links; default https://{site.domain}
//   SMTP_URL / MAIL_FROM   outgoing mail; without SMTP_URL mail is logged
//   HOMES_DIR        where homepage files live; default ./data/homes
//   HOMES_PUBLIC_PORT  port in homepage addresses, for local runs only
//   TLS_ASK_SECRET   shared with Caddy's `ask` URL (?secret=…), optional
//   EXPORTS_DIR      where export archives are kept until they expire; default ./data/exports
//   TRUST_PROXY=1    set when core is behind Caddy
//   RATE_LIMIT=off  turns rate limits off, for automated tests only (refused in production)
export function depsFromEnv(env = process.env, log: (m: string) => void = console.log): AppDeps {
  const config = loadSiteConfig(env.SITE_CONFIG);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const production = env.NODE_ENV === 'production';
  const publicUrl = (env.PUBLIC_URL ?? `https://${config.site.domain}`).replace(/\/$/, '');
  const allowedOrigins = [new URL(publicUrl).origin, `https://${config.site.domain}`];
  // The dev shell (Vite) and the local compose front door.
  if (!production) allowedOrigins.push('http://localhost:5173', 'http://localhost:8080');
  return {
    config,
    db: connect(env.DATABASE_URL),
    mailer: makeMailer({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM ?? `no-reply@${config.site.domain}`, log }),
    secretKey: parseSecretKey(env.APP_SECRET_KEY),
    publicUrl,
    allowedOrigins: [...new Set(allowedOrigins)],
    secureCookies: publicUrl.startsWith('https://'),
    trustProxy: env.TRUST_PROXY === '1',
    rateLimit: rateLimitEnabled(env, production),
    homesUrl: (handle) => `${publicUrl.startsWith('https://') ? 'https' : 'http'}://${handle.toLowerCase()}.${config.site.homes_domain}${env.HOMES_PUBLIC_PORT ? `:${env.HOMES_PUBLIC_PORT}` : ''}/`,
    exportsDir: resolve(env.EXPORTS_DIR ?? './data/exports'),
    homes: new HomeStore(resolve(env.HOMES_DIR ?? './data/homes')),
    oidcClients: resolveOidcClients(config.oidc.clients, env),
    tlsAskSecret: env.TLS_ASK_SECRET || undefined,
    dnsTxt: (name) => dns.resolveTxt(name),
    now: Date.now,
  };
}
