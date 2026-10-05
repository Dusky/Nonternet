import { promises as dns } from 'node:dns';
import { resolve } from 'node:path';
import { parseSecretKey } from './crypto';
import { loadSiteConfig } from './config';
import { connect } from './db';
import type { AppDeps } from './deps';
import { HomeStore } from './homes/files';
import { makeMailer } from './mailer';
import { resolveOidcClients } from './oidc/provider';
import { ircSecrets } from './irc/secrets';
import { mudSecrets } from './mud/secrets';
import { bbsSecrets } from './bbs/secrets';
import { passkeySite } from './passkey-site';

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
//   APPS_DIR         installable app packages, one folder per app (docs/10); default ./data/apps
//   TLS_ASK_SECRET   shared with Caddy's `ask` URL (?secret=…), optional
//   FILES_DIR        where file-area uploads live; default ./data/files
//   EXPORTS_DIR      where export archives are kept until they expire; default ./data/exports
//   TRUST_PROXY=1    set when core is behind Caddy
//   RATE_LIMIT=off  turns rate limits off, for automated tests only (refused in production)
//   IRC_SECRET       shared with Ergo (32+ characters); turns chat on. IRC_HOST/IRC_PORT (default ergo:6667)
//                    are Ergo's private listener for the bot, IRC_API_URL (default http://ergo:8089) its API
//   BBS_SECRET       shared with the BBS (32+ characters); turns it on
//   IRC_HISTORY_DATABASE_URL  Ergo's chat history database (Postgres); read for exports of people's own messages
//   MUD_SECRET       shared with the MUD (32+ characters); turns it on. MUD_URL (default http://mud:4001) is
//                    its internal web server
export function depsFromEnv(env = process.env, log: (m: string) => void = console.log): AppDeps {
  const config = loadSiteConfig(env.SITE_CONFIG);
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const production = env.NODE_ENV === 'production';
  const publicUrl = (env.PUBLIC_URL ?? `https://${config.site.domain}`).replace(/\/$/, '');
  const allowedOrigins = [new URL(publicUrl).origin, `https://${config.site.domain}`];
  // The dev shell (Vite) and the local compose front door.
  if (!production) allowedOrigins.push('http://localhost:5173', 'http://localhost:8080');
  // Passkeys can't belong to an IP address, so a local 127.0.0.1 address also answers as localhost (passkeys.ts).
  if (!production && passkeySite(publicUrl).rpID === 'localhost') allowedOrigins.push(passkeySite(publicUrl).origin);
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
    appsDir: resolve(env.APPS_DIR ?? './data/apps'),
    appsUrl: (path) => `${publicUrl.startsWith('https://') ? 'https' : 'http'}://${config.site.homes_domain}${env.HOMES_PUBLIC_PORT ? `:${env.HOMES_PUBLIC_PORT}` : ''}/apps/${path}`,
    exportsDir: resolve(env.EXPORTS_DIR ?? './data/exports'),
    opsDir: env.OPS_DIR ? resolve(env.OPS_DIR) : undefined,
    filesDir: resolve(env.FILES_DIR ?? './data/files'),
    homes: new HomeStore(resolve(env.HOMES_DIR ?? './data/homes')),
    oidcClients: resolveOidcClients(config.oidc.clients, env),
    tlsAskSecret: env.TLS_ASK_SECRET || undefined,
    dnsTxt: (name) => dns.resolveTxt(name),
    irc: env.IRC_SECRET ? { secrets: ircSecrets(env.IRC_SECRET), host: env.IRC_HOST ?? 'ergo', port: Number(env.IRC_PORT ?? 6667), apiUrl: (env.IRC_API_URL ?? 'http://ergo:8089').replace(/\/$/, ''), historyDatabaseUrl: env.IRC_HISTORY_DATABASE_URL || undefined } : undefined,
    bbs: env.BBS_SECRET ? bbsSecrets(env.BBS_SECRET) : undefined,
    mud: env.MUD_SECRET ? { secrets: mudSecrets(env.MUD_SECRET), url: (env.MUD_URL ?? 'http://mud:4001').replace(/\/$/, '') } : undefined,
    now: Date.now,
  };
}
