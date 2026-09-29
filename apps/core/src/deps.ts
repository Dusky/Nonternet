import type { SiteConfig } from '@app/shared';
import type { Db } from './db';
import type { Mailer } from './mailer';

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
}
