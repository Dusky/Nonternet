import { z } from 'zod';

// `site.*` is the only place the product name and domains live (CLAUDE.md, docs/15).
// There are deliberately no defaults for the name or domains.
const hostname = z
  .string()
  .min(3)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, 'must be a hostname');

export const siteSchema = z.object({
  name: z.string().min(1),
  short_name: z.string().regex(/^[a-z][a-z0-9-]{1,19}$/, 'lowercase letters, digits and hyphens'),
  domain: hostname,
  homes_domain: hostname,
});

export const siteConfigSchema = z
  .object({
    site: siteSchema,
    signup: z
      .object({
        mode: z.enum(['open', 'invite', 'application']).default('invite'),
        require_email: z.boolean().default(true),
      })
      .default({}),
    limits: z
      .object({
        homepage_quota_mb: z.object({ user: z.number().positive(), trusted: z.number().positive() }).default({
          user: 50,
          trusted: 100,
        }),
        trusted_board_quota: z.number().int().nonnegative().default(3),
        trusted_ring_quota: z.number().int().nonnegative().default(2),
      })
      .default({}),
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
    services: cfg.services,
  };
}
