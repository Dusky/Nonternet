import { createContext, useContext, useEffect, useMemo, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWindows, type AppId } from './shell/windows';

// How an app moves between its own screens. An app is shown two ways: on a page of its own (its
// screens follow the address bar) and inside a desktop window (its screens must not touch the
// address bar). React Router won't nest one router in another, so apps use this instead, with one
// implementation for each way of being shown.
export interface Nav {
  id: AppId;                                      // which app this is
  path: string;                                   // the app's current screen, e.g. "users/u_123" (no leading slash)
  go(to: string, opts?: { replace?: boolean }): void;
  href(to: string): string;
}

const NavContext = createContext<Nav | null>(null);
export function useAppNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useAppNav must be used inside an app frame');
  return nav;
}

const trim = (s: string) => s.replace(/^\/+|\/+$/g, '');

// Moving between an app's screens (a list and what's in it) cross-fades briefly with the View Transitions API, where the
// browser has it and the person hasn't asked for less motion. Everywhere else it simply changes. A screen that only
// replaces itself (an app landing on its first screen, a filter) doesn't fade: that is not a move the person made, and
// the page takes no clicks while a transition plays, so a window just opened couldn't be grabbed for a moment.
export function withTransition(change: () => void, opts?: { replace?: boolean }): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (opts?.replace || !doc.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { change(); return; }
  doc.startViewTransition(() => flushSync(change));
}

// On a page of its own: the app lives under `base` (e.g. /admin) and follows the address bar.
export function PageNav({ base, id, children }: { base: string; id: AppId; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const nav = useMemo<Nav>(() => {
    const inside = location.pathname === base || location.pathname.startsWith(`${base}/`);
    return {
      id,
      path: inside ? trim(location.pathname.slice(base.length)) : '',
      go: (to, opts) => withTransition(() => { void navigate(`${base}/${trim(to)}`, opts); }, opts),
      href: (to) => `${base}/${trim(to)}`,
    };
  }, [base, id, location.pathname, navigate]);
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

// In a window: the screen is held in the window's state, so the address bar never changes.
// Links inside it still have real addresses (the app's own page), so "copy link" and "open in new tab" work;
// a plain click stays in the window.
export function WindowNav({ id, base, children }: { id: AppId; base: string; children: ReactNode }) {
  const path = useWindows((s) => s.wins.find((w) => w.id === id)?.path ?? '');
  const setPath = useWindows((s) => s.setPath);
  const nav = useMemo<Nav>(() => ({ id, path: trim(path), go: (to, opts) => withTransition(() => setPath(id, trim(to), opts?.replace), opts), href: (to) => (trim(to) ? `${base}/${trim(to)}` : base) }), [id, base, path, setPath]);
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

// First matching pattern wins. ":name" segments are captured. "users/:id" matches "users/u_1".
export function matchRoute<T extends string>(path: string, patterns: readonly T[]): { pattern: T; params: Record<string, string> } | null {
  const segs = trim(path).split('/').filter(Boolean);
  for (const pattern of patterns) {
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      if (part.startsWith(':')) {
        try { params[part.slice(1)] = decodeURIComponent(segs[i]!); } catch { ok = false; }
      } else if (part !== segs[i]) ok = false;
    }
    if (ok) return { pattern, params };
  }
  return null;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string; prefetch?: () => void };

// An ordinary link that moves inside the app. Middle-click, ctrl-click and "open in new tab" still
// work on a page of its own because it has a real address.
// `prefetch` starts loading what the link opens when the pointer rests on it or it gets focus, so the next screen
// usually has its content the moment it opens.
export function AppLink({ to, onClick, prefetch, ...rest }: LinkProps) {
  const nav = useAppNav();
  const warm = prefetch ? { onPointerEnter: prefetch, onFocus: prefetch } : {};
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    nav.go(to);
  };
  return <a {...warm} {...rest} href={nav.href(to)} onClick={click} />;
}

// A tab: marked as the current page when the app is showing that section.
export function AppNavLink({ to, ...rest }: LinkProps) {
  const nav = useAppNav();
  const current = nav.path === to || nav.path.startsWith(`${to}/`);
  return <AppLink to={to} aria-current={current ? 'page' : undefined} {...rest} />;
}

// Says where in the app you are, for the window title and the browser tab: "Boards — Synths and modular".
// Pass null (or nothing yet) when it isn't known; it is cleared when the screen goes away.
export function useSubtitle(text: string | null | undefined): void {
  const { id } = useAppNav();
  const set = useWindows((s) => s.setSubtitle);
  useEffect(() => {
    set(id, text || null);
    return () => set(id, null);
  }, [id, text, set]);
}
