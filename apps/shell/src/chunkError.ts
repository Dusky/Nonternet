// After a new release the shell's lazy files (one per app) get new names, and a tab still running the old page asks for files
// that are gone. The failed import is not a bug in the app, so it gets its own handling: say the app was updated, and reload the
// page once to pick up the new version.

const MESSAGES = [
  'Failed to fetch dynamically imported module',   // Chrome, Edge, Firefox
  'error loading dynamically imported module',      // Firefox
  'Importing a module script failed',               // Safari
  'Unable to preload CSS',                          // Vite's own preload helper
];
export const isChunkLoadError = (e: unknown): boolean => {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'string' ? e : '';
  return e instanceof Error && e.name === 'ChunkLoadError' || MESSAGES.some((m) => text.includes(m));
};

// The service worker keeps the old page after a release (a new one waits until every tab of the old one is closed), so reloading
// alone brings the same old page back, still asking for files that are gone. Starting fresh means removing the worker and what it
// kept, then loading the page from the network; the worker installs again on that load.
export async function resetServiceWorker(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* no worker, or the browser won't say */ }
  try {
    const keys = (await caches?.keys?.()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* no cache storage */ }
}
export const reloadFresh = (): void => { void resetServiceWorker().finally(() => window.location.reload()); };

const KEY = 'ui:update-reload';
const WINDOW_MS = 60_000;
// Start fresh for an update, but at most once a minute: if the new page fails the same way, stop and let the message show.
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function reloadForUpdate(now = Date.now(), reload: () => void = reloadFresh, store?: Store): boolean {
  try {
    const s = store ?? window.sessionStorage;
    const last = Number(s.getItem(KEY) ?? 0);
    if (last && now - last < WINDOW_MS) return false;
    s.setItem(KEY, String(now));
  } catch { /* no storage: still try once */ }
  reload();
  return true;
}
