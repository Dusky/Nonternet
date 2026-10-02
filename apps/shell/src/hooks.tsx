import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Me, PublicSite } from '@app/shared';
import { en, makeT } from '@app/strings';
import { api, ApiError } from './api';
import { fetchSite } from './site';
import { setFavicon, watchThemeForFavicon } from './shell/tabInfo';
import { applyTheme, hasRememberedTheme } from './theme';

type T = ReturnType<typeof makeT>;
const SiteContext = createContext<{ site: PublicSite; t: T } | null>(null);

// Nothing is drawn until the site's config has loaded: every word on screen (including the site
// name) comes from it, so there is nothing sensible to show before that.
export function SiteProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ['site'], queryFn: fetchSite, staleTime: Infinity, retry: 1 });
  const value = useMemo(() => (q.data ? { site: q.data, t: makeT(q.data) } : null), [q.data]);
  useEffect(() => {
    if (!value) return;
    document.title = value.t('landing.title');
    if (!hasRememberedTheme() && value.site.default_theme) applyTheme(value.site.default_theme, { remember: false });
    setFavicon();
    return watchThemeForFavicon();
  }, [value]);
  if (q.isError) {
    return (
      <main className="center">
        <p role="alert">{en['error.generic']}</p>
        <button className="btn" onClick={() => void q.refetch()}>{en['common.retry']}</button>
      </main>
    );
  }
  if (!value) return null;
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

function useSiteContext() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSite must be used inside SiteProvider');
  return ctx;
}
export const useSite = (): PublicSite => useSiteContext().site;
export const useT = (): T => useSiteContext().t;

// The signed-in user, or null. Errors other than "not signed in" surface as query errors.
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      try {
        return (await api.get<{ user: Me | null }>('/session')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// Windows on a big screen, full-screen apps on a phone (docs/10).
export const DESKTOP_QUERY = '(min-width: 900px)';
export const useIsDesktop = (): boolean => useMediaQuery(DESKTOP_QUERY);

export const errorText = (err: unknown): string => (err instanceof ApiError ? err.message : en['error.generic']);

export function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export const formatBytes = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
