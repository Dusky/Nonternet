import type { BookmarkView } from '@app/shared';

// A bookmark's site icon. The address carries the update time, so a new icon is fetched and an old one stays cached.
export const iconUrl = (b: Pick<BookmarkView, 'id' | 'updated_at'>) => `/api/v1/bookmarks/${b.id}/icon?v=${encodeURIComponent(b.updated_at)}`;
