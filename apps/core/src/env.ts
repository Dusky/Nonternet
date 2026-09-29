import { parseSecretKey } from './crypto';
import { loadSiteConfig } from './config';
import { connect } from './db';
import type { AppDeps } from './deps';
import { makeMailer } from './mailer';
import { resolveOidcClients } from './oidc/provider';

// Everything core needs from its environment, in one place.
//   SITE_CONFIG      path to the site config (required)
//   DATABASE_URL     Postgres connection string (required)
//   APP_SECRET_KEY   32 random bytes, base64 (required)
//   PUBLIC_URL       base of emailed links; default https://{site.domain}
//   SMTP_URL / MAIL_FROM   outgoing mail; without SMTP_URL mail is logged
//   TRUST_PROXY=1    set when core is behind Caddy
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
    rateLimit: true,
    oidcClients: resolveOidcClients(config.oidc.clients, env),
    now: Date.now,
  };
}
