import { publicSiteSchema, type PublicSite } from '@app/shared';

export async function fetchSite(): Promise<PublicSite> {
  const res = await fetch('/api/v1/site');
  if (!res.ok) throw new Error(`site config request failed: ${res.status}`);
  return publicSiteSchema.parse(await res.json());
}
