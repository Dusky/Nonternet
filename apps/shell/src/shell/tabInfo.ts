import { siteMarkSvg } from '@app/shared';
// What the browser tab shows (M9-B): the title says where you are and how much is waiting, and the icon is
// the site's mark in the theme's accent colour with a dot when something is unread.

// "(3) Boards · Site name". The count is mail and notifications together; 100 or more shows as "99+".
export function tabTitle(opts: { site: string; app?: string | null; unread?: number }): string {
  const n = opts.unread ?? 0;
  const count = n > 0 ? `(${n > 99 ? '99+' : n}) ` : '';
  return `${count}${opts.app ? `${opts.app} · ` : ''}${opts.site}`;
}

// An SVG for the tab icon: the site's mark (packages/shared) in the theme's colours.
export function faviconSvg(opts: { accent: string; bg: string; badge: boolean }): string {
  return siteMarkSvg(opts);
}

export const faviconHref = (opts: Parameters<typeof faviconSvg>[0]): string => `data:image/svg+xml,${encodeURIComponent(faviconSvg(opts))}`;

let badged = false;

// Puts the icon in the page, making the <link> if it is missing. Reads the colours the theme is using now.
export function setFavicon(badge: boolean = badged): void {
  if (typeof document === 'undefined') return;
  badged = badge;
  const css = getComputedStyle(document.documentElement);
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/svg+xml'; document.head.appendChild(link); }
  link.href = faviconHref({ accent: css.getPropertyValue('--accent'), bg: css.getPropertyValue('--bg'), badge });
}

// Recolours the icon when the theme changes. Returns a function that stops watching.
export function watchThemeForFavicon(): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const mo = new MutationObserver(() => setFavicon());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
