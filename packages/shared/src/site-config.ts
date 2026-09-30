import { z } from 'zod';

// `site.*` is the only place the product name and domains live (CLAUDE.md, docs/15).
// There are deliberately no defaults for the name or domains.
const hostname = z
  .string()
  .min(3)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, 'must be a hostname');

// IRC channel names we accept for registered channels: # then lowercase letters, digits, - and _.
export const ircChannelName = z.string().regex(/^#[a-z0-9][a-z0-9_-]{0,29}$/, 'a # followed by up to 30 lowercase letters, digits, - or _');

export const siteSchema = z.object({
  name: z.string().min(1),
  short_name: z.string().regex(/^[a-z][a-z0-9-]{1,19}$/, 'lowercase letters, digits and hyphens'),
  domain: hostname,
  homes_domain: hostname,
});

// Services that sign users in through the OIDC provider (IRC, MUD, BBS…). All are first-party, so
// there is no consent screen. A confidential client's secret is read from the environment
// (OIDC_SECRET_<CLIENT_ID>), never from this file.
const redirectUri = z.string().url().refine(
  (u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u),
  'must be https (http is allowed only for localhost)',
);
export const oidcClientSchema = z.object({
  client_id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'lowercase letters, digits and hyphens'),
  redirect_uris: z.array(redirectUri).min(1),
  post_logout_redirect_uris: z.array(redirectUri).default([]),
  // Public clients (browser apps) use PKCE with no secret. Confidential clients (servers) also
  // authenticate with a secret.
  public: z.boolean().default(false),
});
export type OidcClient = z.infer<typeof oidcClientSchema>;

export const siteConfigSchema = z
  .object({
    site: siteSchema,
    signup: z
      .object({
        mode: z.enum(['open', 'invite', 'application']).default('invite'),
        require_email: z.boolean().default(true),
        // People confirm at signup that they are at least this old. 0 turns the question off (docs/02, decided 2026-09-30).
        minimum_age: z.number().int().min(0).max(120).default(16),
      })
      .default({}),
    limits: z
      .object({
        homepage_quota_mb: z.object({ user: z.number().positive(), trusted: z.number().positive() }).default({
          user: 50,
          trusted: 100,
        }),
        homepage_file_max_mb: z.number().positive().default(10),
        trusted_board_quota: z.number().int().nonnegative().default(3),
        trusted_ring_quota: z.number().int().nonnegative().default(2),
        // IRC channels a trusted user may register besides ring channels (docs/08, decided 2026-09-30).
        trusted_channel_quota: z.number().int().nonnegative().default(3),
      })
      .default({}),
    homes: z
      .object({
        // The address the homes server answers on. A bare custom domain needs an A record to it.
        public_ip: z.string().regex(/^[0-9a-f.:]+$/i, 'an IPv4 or IPv6 address').optional(),
        max_domains: z.number().int().nonnegative().default(3),
      })
      .default({}),
    irc: z
      .object({
        // Registered at start, owned by the site; admins are channel ops in them (docs/08).
        official_channels: z.array(ircChannelName).min(1).default(['#lobby', '#help']),
        // Where native clients connect; default irc.{site.domain}.
        public_host: hostname.optional(),
        public_port: z.number().int().min(1).max(65535).default(6697),
        // Messages are kept in memory for this long, for scrollback (docs/08).
        history_days: z.number().int().min(0).max(365).default(7),
      })
      .default({}),
    moderation: z
      .object({
        // The mod log of each board is readable by anyone who can read the board (docs/03).
        public_modlog: z.boolean().default(true),
      })
      .default({}),
    oidc: z
      .object({ clients: z.array(oidcClientSchema).default([]) })
      .default({})
      .superRefine((o, ctx) => {
        const seen = new Set<string>();
        for (const c of o.clients) {
          if (seen.has(c.client_id)) ctx.addIssue({ code: 'custom', path: ['clients'], message: `duplicate client_id ${c.client_id}` });
          seen.add(c.client_id);
        }
      }),
    services: z
      .object({
        bbs: z.boolean().default(false),
        irc: z.boolean().default(false),
        mud: z.boolean().default(false),
      })
      .default({}),
  })
  .superRefine((cfg, ctx) => {
    // Homepages run untrusted user HTML, so they must never share the shell's origin (docs/15).
    // A separate registrable domain is preferred (docs/01); a separate subdomain tree is allowed.
    if (cfg.site.domain.toLowerCase() === cfg.site.homes_domain.toLowerCase()) {
      ctx.addIssue({ code: 'custom', path: ['site', 'homes_domain'], message: 'must differ from site.domain' });
    }
  });

export type SiteConfig = z.infer<typeof siteConfigSchema>;

// The part of the config the shell and public pages may see.
export const publicSiteSchema = z.object({
  name: z.string(),
  short_name: z.string(),
  domain: z.string(),
  homes_domain: z.string(),
  signup_mode: z.enum(['open', 'invite', 'application']),
  minimum_age: z.number().int(),
  irc: z.object({ host: z.string(), port: z.number().int(), lobby: z.string() }),
  services: z.object({ bbs: z.boolean(), irc: z.boolean(), mud: z.boolean() }),
});
export type PublicSite = z.infer<typeof publicSiteSchema>;

export function toPublicSite(cfg: SiteConfig): PublicSite {
  return {
    name: cfg.site.name,
    short_name: cfg.site.short_name,
    domain: cfg.site.domain,
    homes_domain: cfg.site.homes_domain,
    signup_mode: cfg.signup.mode,
    minimum_age: cfg.signup.minimum_age,
    irc: { host: cfg.irc.public_host ?? `irc.${cfg.site.domain}`, port: cfg.irc.public_port, lobby: cfg.irc.official_channels[0]! },
    services: cfg.services,
  };
}
