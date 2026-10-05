/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

// The service worker (docs/10). It does three things and nothing else:
// - keeps the shell's own files so the site opens without a connection and shows the offline banner instead of the
//   browser's error page. The page and its entry files are kept when the worker installs; every other file (an app's
//   code, fonts, pictures) the first time it is fetched. Their names carry a hash, so a kept copy is never stale. Nothing from /api is ever stored: people's data stays
//   on the server and in the tab, and is never left behind on a shared computer.
// - shows push notifications: who and where, as core sent them (core/src/push.ts).
// - opens the right screen when one is clicked, reusing an open tab when there is one.
// A new version waits until every tab of the old one is closed, so a page never runs half old and half new.
declare const self: ServiceWorkerGlobalScope;

// The server's own paths skip this worker entirely where the browser can say so (static routing, Chrome 123+). Besides
// being quicker, a request the worker sees can be dropped when its page closes, and the sends that Undo holds until
// the page is left (components/feedback.tsx) are exactly those. Elsewhere the worker lets them through untouched.
type RouteRule = { condition: { urlPattern: { pathname: string } }; source: 'network' };
self.addEventListener('install', (event) => {
  const e = event as ExtendableEvent & { addRoutes?: (rules: RouteRule[]) => Promise<void> };
  if (!e.addRoutes) return;
  const rules = ['/api/*', '/oidc/*', '/ring/*', '/feeds/*', '/widgets/*', '/ws/*'].map((pathname): RouteRule => ({ condition: { urlPattern: { pathname } }, source: 'network' }));
  e.waitUntil(e.addRoutes(rules).catch(() => undefined));
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(({ url, request }) => url.origin === self.location.origin && url.pathname.startsWith('/assets/') && request.method === 'GET',
  new CacheFirst({ cacheName: 'shell-assets' }));
// Any address in the shell opens the cached page, which then routes itself. Server routes are left to the network.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/oidc/, /^\/ring\//, /^\/feeds\//, /^\/widgets\//, /^\/ws\//] }));

interface Message { title: string; body: string; url: string; tag: string }

self.addEventListener('push', (event) => {
  let m: Message;
  try { m = event.data!.json() as Message; } catch { return; }
  event.waitUntil((async () => {
    // Someone looking at the site already hears about it there (the tab's own note and chime).
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (tabs.some((c) => (c as WindowClient).focused && (c as WindowClient).visibilityState === 'visible')) return;
    await self.registration.showNotification(m.title, { body: m.body, tag: m.tag, data: { url: m.url }, icon: '/api/v1/site/icon-192.png', badge: '/api/v1/site/icon-192.png' });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data as { url?: string } | null)?.url ?? '/';
  // Only places on this site: the address came from core, but a notification is no place to trust a full URL.
  const url = new URL(raw.startsWith('/') && !raw.startsWith('//') ? raw : '/', self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs[0] as WindowClient | undefined;
    if (tab) { await tab.focus(); await tab.navigate(url).catch(() => undefined); return; }
    await self.clients.openWindow(url);
  })());
});
