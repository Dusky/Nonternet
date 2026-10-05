import sharp from 'sharp';
import { MARK_COLOURS, siteMarkSvg, type SiteConfig } from '@app/shared';

// The installable app (docs/10): a manifest made from the site config, so the name is never built into the shell, and
// icons drawn from the site's mark. The icons are made once per process and kept.
export function webManifest(config: SiteConfig) {
  const name = config.site.name;
  return {
    name,
    // The name under the icon on a home screen; a long name falls back to the short one.
    short_name: name.length <= 12 ? name : config.site.short_name,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: MARK_COLOURS.bg,
    theme_color: MARK_COLOURS.accent,
    icons: [
      { src: '/api/v1/site/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/api/v1/site/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/api/v1/site/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

const made = new Map<string, Promise<Buffer>>();
export function siteIcon(kind: '192' | '512' | 'maskable'): Promise<Buffer> {
  let p = made.get(kind);
  if (!p) {
    const size = kind === '192' ? 192 : 512;
    p = sharp(Buffer.from(siteMarkSvg({ square: kind === 'maskable' })), { density: 72 * (size / 64) }).resize(size, size).png().toBuffer();
    made.set(kind, p);
  }
  return p;
}
