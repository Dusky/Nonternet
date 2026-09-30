import type { SiteConfig } from '@app/shared';
import type { Db } from './db';
import type { HomeStore } from './homes/files';
import type { Mailer } from './mailer';
import type { ResolvedOidcClient } from './oidc/provider';
import type { IrcDeps } from './irc/secrets';
import type { MudDeps } from './mud/secrets';

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
  exportsDir: string;       // where finished export archives wait to be downloaded
  filesDir: string;         // where file-area uploads live, one file per ID
  homes: HomeStore;         // where homepage files live
  homesUrl: (handle: string) => string; // a person's homepage address
  oidcClients: ResolvedOidcClient[]; // services allowed to sign users in (site config + env secrets)
  tlsAskSecret?: string;    // when set, Caddy's certificate question must carry it
  dnsTxt: (name: string) => Promise<string[][]>; // TXT lookup, injectable so tests need no network
  irc?: IrcDeps;            // set when IRC_SECRET is; chat is off without it
  mud?: MudDeps;            // set when MUD_SECRET is; the MUD is off without it
  now: () => number;        // ms; injectable so tests can move the clock (TOTP steps)
}
