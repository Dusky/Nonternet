// After logging in we go back to where the person was headed (`?return_to=`). That value comes
// from the URL, so it can be set by anyone who can get someone to click a link. Only this site's
// own origin is honoured, or a phishing link could bounce a fresh login to somewhere else.
export type Destination = { kind: 'app'; to: string } | { kind: 'page'; url: string };

// Paths served by the API rather than the single-page app need a full page load, e.g. the OIDC
// sign-in step that completes a service's login.
const SERVER_PREFIXES = ['/api/', '/oidc'];

export function safeReturnTo(value: string | null | undefined, origin: string): Destination | null {
  if (!value) return null;
  // A backslash or a control character is how "//evil.example" style tricks get past naive checks.
  if (/[\\\u0000-\u001f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const to = `${url.pathname}${url.search}${url.hash}`;
  if (SERVER_PREFIXES.some((p) => url.pathname === p.replace(/\/$/, '') || url.pathname.startsWith(p))) return { kind: 'page', url: url.toString() };
  // Never bounce back to a page that only makes sense before logging in.
  if (['/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'].includes(url.pathname)) return null;
  return { kind: 'app', to };
}
