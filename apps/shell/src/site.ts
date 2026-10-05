import { publicSiteSchema, type PublicSite } from '@app/shared';

// The site's public config. The last copy is kept on the device, so without a connection the shell can still open
// (from the service worker) and say it is offline, instead of failing at the first request. It is public: nothing
// about the person is in it.
const KEPT = 'site:last';
export async function fetchSite(): Promise<PublicSite> {
  let res: Response;
  try {
    res = await fetch('/api/v1/site');
  } catch (e) {
    const kept = keptSite();
    if (kept) return kept;
    throw e;
  }
  if (!res.ok) throw new Error(`site config request failed: ${res.status}`);
  const site = publicSiteSchema.parse(await res.json());
  try { localStorage.setItem(KEPT, JSON.stringify(site)); } catch { /* private window: fine */ }
  return site;
}
function keptSite(): PublicSite | null {
  try {
    const raw = localStorage.getItem(KEPT);
    return raw ? publicSiteSchema.parse(JSON.parse(raw)) : null;
  } catch { return null; }
}
