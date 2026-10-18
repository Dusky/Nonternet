import { en } from '@app/strings';
import type { BookmarkView, Me } from '@app/shared';
import { api } from '../api';
import { errorText } from '../hooks';
import { toast } from '../components/feedback';
import { APPS } from './apps';
import { useDesktopLayout } from './desktopLayout';
import { placePath, type ShortcutTarget } from './desktopLayout.logic';
import type { AppId } from './windows';

// Dropping a link on the desktop (docs/10): a link to this site becomes a shortcut to that place; any other web address is saved
// as a private bookmark and gets a shortcut. Nothing is fetched from the dropped address by the browser.

// The address and its title from a drop, if it carried a web address.
export function linkFromDrop(dt: Pick<DataTransfer, 'getData'>): { url: string; title: string } | null {
  const moz = dt.getData('text/x-moz-url').split('\n');
  const list = dt.getData('text/uri-list').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
  const url = (moz[0] || list || dt.getData('text/plain')).trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return null;
  try { new URL(url); } catch { return null; }
  return { url, title: (moz[1] ?? '').trim() };
}

// A link to this site, as a place inside one of its apps; null for anything else.
export function placeForUrl(url: string, origin: string): { app: AppId; path: string } | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.origin !== origin) return null;
  const app = APPS.find((a) => u.pathname === a.path || u.pathname.startsWith(`${a.path}/`));
  return app ? { app: app.id, path: placePath(u.pathname.slice(app.path.length)) } : null;
}

const short = (url: string) => { try { const u = new URL(url); return (u.hostname + u.pathname).replace(/\/$/, '').slice(0, 60); } catch { return url.slice(0, 60); } };

export async function dropLink(link: { url: string; title: string }, me: Me, origin = window.location.origin): Promise<void> {
  await useDesktopLayout.getState().load();
  const add = (label: string, target: ShortcutTarget) => useDesktopLayout.getState().addShortcut(label, target);
  const place = placeForUrl(link.url, origin);
  if (place) {
    const title = APPS.find((a) => a.id === place.app)?.title;
    const r = add(link.title || (title ? en[title] : short(link.url)), { type: 'place', app: place.app, path: place.path });
    if (r === 'full') toast(en['desktop.shortcut.full'], 'error');
    else if (r && !r.added) toast(en['desktop.shortcut.already']);
    else if (r) toast(en['desktop.shortcut.added'], 'ok', { undo: () => useDesktopLayout.getState().removeShortcut(r.id) });
    return;
  }
  if (me.role === 'guest') { toast(en['desktop.drop.guest'], 'error'); return; }
  try {
    const saved = await api.post<{ bookmark: BookmarkView; existing: boolean }>('/bookmarks', { url: link.url, ...(link.title ? { title: link.title.slice(0, 200) } : {}) });
    const r = add(saved.bookmark.title || short(link.url), { type: 'bookmark', bookmark_id: saved.bookmark.id });
    if (r === 'full') { toast(en['desktop.shortcut.full'], 'error'); return; }
    if (!r) return;
    toast(saved.existing ? en['desktop.drop.existing'] : en['desktop.drop.saved'], 'ok', {
      undo: () => {
        if (r.added) useDesktopLayout.getState().removeShortcut(r.id);
        if (!saved.existing) void api.del(`/bookmarks/${saved.bookmark.id}`).catch(() => undefined);
      },
    });
  } catch (err) {
    toast(errorText(err), 'error');
  }
}
