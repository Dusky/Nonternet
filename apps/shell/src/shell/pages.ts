import type { BoardSummary } from '@app/shared';
import type { AppId, BuiltinAppId } from './windows';

// Page numbers (docs/10, 17 2026-10-18), after Teletext: every app has a fixed number, boards get theirs from core
// (201, 202, …, kept for good), and Settings pages sit under 900. Typing a number in the palette goes there. Apps someone
// added themselves have no number.
export const APP_PAGES: Record<BuiltinAppId | 'home', number> = {
  home: 100, boards: 200, mail: 300, chat: 350, people: 400, rings: 450, wiki: 500, memos: 550, bookmarks: 600,
  files: 650, homepages: 700, studio: 750, terminal: 800, mud: 820, notifications: 850, addapps: 870, settings: 900, admin: 990,
};
export const SETTINGS_PAGES = ['profile', 'appearance', 'notifications', 'password', 'two-factor', 'passkeys', 'terminal', 'data'] as const;

export type PageTarget = { app: AppId | 'home'; path: string };
type PagedBoard = Pick<BoardSummary, 'slug' | 'page'>;

export const appPage = (id: AppId): number | null => (id in APP_PAGES ? APP_PAGES[id as BuiltinAppId] : null);

// A number to where it goes, or null when nothing has it.
export function pageTarget(n: number, boards: readonly PagedBoard[]): PageTarget | null {
  for (const [app, page] of Object.entries(APP_PAGES)) if (page === n) return { app: app as AppId | 'home', path: '' };
  if (n > 900 && n <= 900 + SETTINGS_PAGES.length) return { app: 'settings', path: SETTINGS_PAGES[n - 901]! };
  const b = boards.find((x) => x.page === n);
  return b ? { app: 'boards', path: b.slug } : null;
}

// A place to its number, when it has one: an app's front page, a board's page, a Settings page.
export function pageOf(app: AppId, path: string, boards: readonly PagedBoard[]): number | null {
  const first = path.split(/[/?#]/)[0] ?? '';
  if (!first) return appPage(app);
  if (app === 'boards') return boards.find((b) => b.slug === first)?.page ?? null;
  if (app === 'settings') { const i = (SETTINGS_PAGES as readonly string[]).indexOf(first); return i >= 0 ? 901 + i : null; }
  return null;
}

// What someone typed, when it is a page number (three or four digits).
export const asPageNumber = (q: string): number | null => (/^\d{3,4}$/.test(q.trim()) ? Number(q.trim()) : null);
