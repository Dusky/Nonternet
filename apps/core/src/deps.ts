import type { SiteConfig } from '@app/shared';
import type { Db } from './db';
import type { HomeStore } from './homes/files';
import type { Mailer } from './mailer';
import type { ResolvedOidcClient } from './oidc/provider';
import type { IrcDeps } from './irc/secrets';
import type { MudDeps } from './mud/secrets';
import type { BbsDeps } from './bbs/secrets';
import type { PushDeps } from './push';

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
  opsDir?: string;          // shared with `sitectl agent` on the host, for updates and restarts from the console (docs/19)
  filesDir: string;         // where file-area uploads live, one file per ID
  homes: HomeStore;         // where homepage files live
  homesUrl: (handle: string) => string; // a person's homepage address
  appsDir?: string;         // installable app packages, one folder each (docs/10); none when unset
  appsUrl: (path: string) => string; // an address under the apps area of the homes origin
  oidcClients: ResolvedOidcClient[]; // services allowed to sign users in (site config + env secrets)
  tlsAskSecret?: string;    // when set, Caddy's certificate question must carry it
  dnsTxt: (name: string) => Promise<string[][]>; // TXT lookup, injectable so tests need no network
  irc?: IrcDeps;            // set when IRC_SECRET is; chat is off without it
  mud?: MudDeps;            // set when MUD_SECRET is; the MUD is off without it
  bbs?: BbsDeps;            // set when BBS_SECRET is; the BBS is off without it
  push?: PushDeps;          // set when the VAPID keys are; push notifications are off without them
  now: () => number;        // ms; injectable so tests can move the clock (TOTP steps)
}
