import { createContext, useContext, useMemo, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWindows, type AppId } from './shell/windows';

// How an app moves between its own screens. An app is shown two ways: on a page of its own (its
// screens follow the address bar) and inside a desktop window (its screens must not touch the
// address bar). React Router won't nest one router in another, so apps use this instead, with one
// implementation for each way of being shown.
export interface Nav {
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

// On a page of its own: the app lives under `base` (e.g. /admin) and follows the address bar.
export function PageNav({ base, children }: { base: string; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const nav = useMemo<Nav>(() => {
    const inside = location.pathname === base || location.pathname.startsWith(`${base}/`);
    return {
      path: inside ? trim(location.pathname.slice(base.length)) : '',
      go: (to, opts) => navigate(`${base}/${trim(to)}`, opts),
      href: (to) => `${base}/${trim(to)}`,
    };
  }, [base, location.pathname, navigate]);
  return <NavContext.Provider value={nav}>{children}</NavContext.Provider>;
}

// In a window: the screen is held in the window's state, so the address bar never changes.
export function WindowNav({ id, children }: { id: AppId; children: ReactNode }) {
  const path = useWindows((s) => s.wins.find((w) => w.id === id)?.path ?? '');
  const setPath = useWindows((s) => s.setPath);
  const nav = useMemo<Nav>(() => ({ path: trim(path), go: (to) => setPath(id, trim(to)), href: (to) => `#${trim(to)}` }), [id, path, setPath]);
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

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

// An ordinary link that moves inside the app. Middle-click, ctrl-click and "open in new tab" still
// work on a page of its own because it has a real address.
export function AppLink({ to, onClick, ...rest }: LinkProps) {
  const nav = useAppNav();
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    nav.go(to);
  };
  return <a {...rest} href={nav.href(to)} onClick={click} />;
}

// A tab: marked as the current page when the app is showing that section.
export function AppNavLink({ to, ...rest }: LinkProps) {
  const nav = useAppNav();
  const current = nav.path === to || nav.path.startsWith(`${to}/`);
  return <AppLink to={to} aria-current={current ? 'page' : undefined} {...rest} />;
}
