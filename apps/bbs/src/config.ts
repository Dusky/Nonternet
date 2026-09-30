import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { siteConfigSchema, type SiteConfig } from '@app/shared';

// Environment (docs/04, 15):
//   SITE_CONFIG        the site config file (name, domain, bbs limits)
//   CORE_URL           core's internal address, e.g. http://core:3000
//   PUBLIC_URL         the site's public address (links shown to callers; the Origin sent to core)
//   BBS_SECRET         shared with core (32+ characters)
//   BBS_TELNET_PORT, BBS_SSH_PORT, BBS_WS_PORT   where to listen (2323, 2222, 2380)
//   BBS_HOST_KEY_FILE  the SSH host key; made on first start if missing (./data/ssh_host_ed25519_key)
//   BBS_ART_DIR        the art pack (./art/default)
//   BBS_TRUSTED_PROXY  addresses whose X-Forwarded-For is believed (Caddy), comma-separated
export interface BbsEnv {
  site: SiteConfig; coreUrl: string; publicUrl: string; secret: string; authToken: string;
  telnetPort: number; sshPort: number; wsPort: number; hostKeyFile: string; artDir: string; trustedProxies: string[];
}

export const bbsAuthToken = (secret: string) => createHmac('sha256', secret).update('bbs:auth').digest('base64url');

export function envFrom(env: NodeJS.ProcessEnv): BbsEnv {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`${k} is required`); return v; };
  const secret = need('BBS_SECRET');
  if (secret.length < 32) throw new Error('BBS_SECRET must be at least 32 characters');
  const parsed = siteConfigSchema.safeParse(parse(readFileSync(need('SITE_CONFIG'), 'utf8')));
  if (!parsed.success) throw new Error(`SITE_CONFIG: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return {
    site: parsed.data, coreUrl: need('CORE_URL').replace(/\/$/, ''), publicUrl: need('PUBLIC_URL').replace(/\/$/, ''), secret, authToken: bbsAuthToken(secret),
    telnetPort: Number(env.BBS_TELNET_PORT ?? 2323), sshPort: Number(env.BBS_SSH_PORT ?? 2222), wsPort: Number(env.BBS_WS_PORT ?? 2380),
    hostKeyFile: env.BBS_HOST_KEY_FILE ?? './data/ssh_host_ed25519_key', artDir: env.BBS_ART_DIR ?? './art/default',
    trustedProxies: (env.BBS_TRUSTED_PROXY ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
