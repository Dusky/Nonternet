import type { SiteConfig } from '@app/shared';
import type { Db } from './db';
import type { HomeStore } from './homes/files';
import type { Mailer } from './mailer';
import type { ResolvedOidcClient } from './oidc/provider';

export interface AppDeps {
  config: SiteConfig;
  db: Db;
  mailer: Mailer;
  secretKey: Buffer;
  publicUrl: string;        // base of links sent by email
  allowedOrigins: string[]; // browsers may make state-changing requests only from these
  secureCookies: boolean;
  trustProxy: boolean;      // true only when core sits behind Caddy
  rateLimit: boolean;
  homes: HomeStore;         // where homepage files live
  homesUrl: (handle: string) => string; // a person's homepage address
  oidcClients: ResolvedOidcClient[]; // services allowed to sign users in (site config + env secrets)
  now: () => number;        // ms; injectable so tests can move the clock (TOTP steps)
}
