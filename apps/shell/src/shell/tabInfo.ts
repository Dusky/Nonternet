// What the browser tab shows (M9-B): the title says where you are and how much is waiting, and the icon is
// the site's mark in the theme's accent colour with a dot when something is unread.

// "(3) Boards · Site name". The count is mail and notifications together; 100 or more shows as "99+".
export function tabTitle(opts: { site: string; app?: string | null; unread?: number }): string {
  const n = opts.unread ?? 0;
  const count = n > 0 ? `(${n > 99 ? '99+' : n}) ` : '';
  return `${count}${opts.app ? `${opts.app} · ` : ''}${opts.site}`;
}

const safeColour = (c: string, fallback: string) => (/^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : fallback);

// An SVG for the tab icon. Colours come from the theme (hex only, anything else falls back).
export function faviconSvg(opts: { accent: string; bg: string; badge: boolean }): string {
  const accent = safeColour(opts.accent, '#2b4fd6');
  const bg = safeColour(opts.bg, '#f4f2ec');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/>`
    + `<rect x="22" y="14" width="20" height="36" rx="2" fill="${accent}"/>`
    + (opts.badge ? `<circle cx="50" cy="14" r="11" fill="#d92d20" stroke="${bg}" stroke-width="4"/>` : '')
    + '</svg>';
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
