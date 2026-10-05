// Routes anyone may call without a session (docs/15). Everything else needs one: the preHandler in app.ts
// refuses a request with no session before the route's own code runs, so a new route is private unless it
// is added here on purpose. /internal/* (service tokens), /oidc (its own client auth) and the widget API
// (never reads a session) are handled by their own checks. Routes still check roles themselves.
export const PUBLIC_ROUTES: [method: string, pattern: RegExp, why: string][] = [
  ['GET', /^\/(healthz|readyz)$/, 'health checks'],
  ['GET', /^\/api\/v1\/site$/, 'the public site config'],
  ['GET', /^\/api\/v1\/site\/(manifest\.webmanifest|:icon)$/, 'the installable app\u2019s manifest and icons, made from the site config (docs/10)'],
  ['GET', /^\/api\/v1\/push$/, 'the public key a browser needs to sign up for push'],
  ['GET', /^\/api\/v1\/landing$/, 'the front page for visitors: a count of people online and things already public (docs/10)'],
  ['GET', /^\/api\/v1\/session$/, 'who is signed in, or null: so a visitor\u2019s first request is not an error (`/me` answers 401)'],
  ['GET', /^\/api\/v1\/announcements$/, 'banners for everyone'],
  ['GET', /^\/api\/v1\/bbs\/motd$/, 'the BBS message of the day'],
  ['GET', /^\/api\/v1\/legal(\/.*)?$/, 'the site’s legal pages'],
  ['POST', /^\/api\/v1\/legal\/requests$/, 'takedown requests come from anyone'],
  ['POST', /^\/api\/v1\/auth\/(signup|login|logout|verify-email|confirm-email|resend-verification|forgot-password|reset-password)$/, 'signing up and in, and forgotten passwords'],
  ['POST', /^\/api\/v1\/auth\/passkey(\/options)?$/, 'signing in with a passkey (docs/02)'],
  ['GET', /^\/api\/v1\/oidc\/interaction\/:uid$/, 'the sign-in step of the OIDC flow'],
  ['GET', /^\/api\/v1\/boards(\/:slug(\/threads(\/:id)?)?)?$/, 'public boards read without logging in (docs/05)'],
  ['GET', /^\/api\/v1\/modlog$/, 'the public mod log (docs/03)'],
  ['GET', /^\/api\/v1\/rings(\/random|\/:slug(\/members)?)?$/, 'the ring directory'],
  ['GET', /^\/api\/v1\/rings\/:slug\/(banners|banner\/:kind)$/, 'ring banners are shown on member pages and in the directory'],
  ['GET', /^\/api\/v1\/homepages(\/random)?$/, 'the homepage directory'],
  ['GET', /^\/api\/v1\/homes\/(templates|assets(\/:id)?)$/, 'the studio’s templates and assets'],
  ['POST', /^\/api\/v1\/homes\/:handle\/guestbook$/, 'guestbooks take signatures from visitors'],
  ['GET', /^\/api\/v1\/users\/:handle$/, 'public profiles'],
  ['GET', /^\/api\/v1\/files(\/areas\/:slug|\/:id(\/download)?)?$/, 'public file areas (docs/05)'],
  ['GET', /^\/api\/v1\/search$/, 'searching public boards'],
  ['GET', /^\/ring\//, 'webring navigation for visitors of homepages'],
  ['GET', /^\/api\/v1\/wiki\/:wiki(\/(pages|changes|wanted|search)(\/:slug(\/(history|links-here|revisions\/:revision))?)?)?$/, 'reading the site wiki and ring wikis, as public boards are read (docs/20)'],
  ['GET', /^\/feeds\//, 'Atom feeds of public boards and people\u2019s public posts (docs/05)'],
];

export function isPublicRoute(method: string, url: string): boolean {
  if (url.startsWith('/internal/') || url === '/oidc' || url.startsWith('/oidc/') || url.startsWith('/widgets/') || url.startsWith('/api/v1/widgets/')) return true;
  if (method === 'OPTIONS') return true;
  return PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(url));
}
