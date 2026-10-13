import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BookmarkView, DesktopShortcut } from '@app/shared';
import { api, ApiError } from '../api';
import { Icon } from '../components/Icon';
import { iconUrl } from '../apps/bookmarks/icon';
import { AppTile } from './icons';
import type { AppId } from './windows';

// What a shortcut looks like and whether it still leads anywhere. A place is missing when its app is no longer on this person's
// list; a bookmark when it has been deleted (a failed request for any other reason leaves the shortcut as it was).
export function useShortcutView(sc: DesktopShortcut, available: Set<string>): { tile: ReactNode; missing: boolean; url?: string } {
  const target = sc.target;
  const bookmark = useQuery({
    queryKey: ['bookmarks', 'one', target.type === 'bookmark' ? target.bookmark_id : ''],
    queryFn: () => api.get<BookmarkView>(`/bookmarks/${(target as { bookmark_id: string }).bookmark_id}`),
    enabled: target.type === 'bookmark',
    retry: false,
    staleTime: 60_000,
  });
  if (target.type === 'place') {
    const missing = !available.has(target.app);
    return { missing, tile: missing ? <MissingTile /> : <ShortcutTile><AppTile id={target.app as AppId} /></ShortcutTile> };
  }
  const gone = bookmark.error instanceof ApiError && bookmark.error.status === 404;
  const b = bookmark.data;
  return {
    missing: gone,
    url: b?.url,
    tile: gone ? <MissingTile /> : (
      <ShortcutTile>
        <span className="app-tile" data-sticker="3">{b?.has_icon ? <img src={iconUrl(b)} alt="" width={26} height={26} /> : <Icon name="link" size={26} />}</span>
      </ShortcutTile>
    ),
  };
}

// The tile with a small arrow in the corner, so a shortcut reads as one.
const ShortcutTile = ({ children }: { children: ReactNode }) => <span className="shortcut-tile">{children}<span className="shortcut-arrow" aria-hidden="true">↗</span></span>;
const MissingTile = () => <span className="shortcut-tile"><span className="app-tile" data-sticker="1"><Icon name="link" size={26} /></span></span>;
