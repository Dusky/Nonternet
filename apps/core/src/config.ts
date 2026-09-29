import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { siteConfigSchema, type SiteConfig } from '@app/shared';

// The site config file is the single source of the product name and domains (CLAUDE.md).
// It is required: there is no built-in fallback name.
export function parseSiteConfig(text: string): SiteConfig {
  const result = siteConfigSchema.safeParse(parse(text));
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid site config:\n${problems}`);
  }
  return result.data;
}

export function loadSiteConfig(path: string | undefined = process.env.SITE_CONFIG): SiteConfig {
  if (!path) throw new Error('SITE_CONFIG must point to a site config file (see deploy/site.example.yaml)');
  return parseSiteConfig(readFileSync(path, 'utf8'));
}
