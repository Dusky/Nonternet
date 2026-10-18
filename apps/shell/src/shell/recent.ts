import { create } from 'zustand';
import type { AppId } from './windows';

// Places opened lately (docs/10): kept on this device for each person, newest first, never sent anywhere (like the palette's
// own list was). Recorded when a screen says where it is (useSubtitle), so only real places land here.
export interface RecentPlace { app: AppId; path: string; label: string; at: number }
export const RECENT_MAX = 12;
const key = (userId: string) => `ui:recent:${userId}`;
const OLD_PALETTE_KEY = 'ui:palette:recent';

const valid = (r: unknown): r is RecentPlace => {
  const x = r as RecentPlace;
  return Boolean(x) && typeof x.app === 'string' && typeof x.path === 'string' && typeof x.label === 'string' && x.label.length > 0 && x.path.length <= 300;
};

// Pure: the list after visiting a place (moved to the front if it was there, capped).
export function addRecent(list: RecentPlace[], place: Omit<RecentPlace, 'at'>, at = Date.now()): RecentPlace[] {
  if (!place.path || !place.label) return list;
  return [{ ...place, label: place.label.slice(0, 120), at }, ...list.filter((r) => !(r.app === place.app && r.path === place.path))].slice(0, RECENT_MAX);
}

function read(userId: string): RecentPlace[] {
  try {
    const raw = localStorage.getItem(key(userId));
    if (raw) return (JSON.parse(raw) as unknown[]).filter(valid).slice(0, RECENT_MAX);
    // The palette kept its own list before this one; bring it over once, then drop it.
    const old = JSON.parse(localStorage.getItem(OLD_PALETTE_KEY) ?? '[]') as { app?: string; path?: string; label?: string }[];
    localStorage.removeItem(OLD_PALETTE_KEY);
    return old.map((o, i) => ({ app: o.app as AppId, path: o.path ?? '', label: o.label ?? '', at: Date.now() - i })).filter(valid).filter((r) => r.path);
  } catch { return []; }
}
function write(userId: string, list: RecentPlace[]) {
  try { localStorage.setItem(key(userId), JSON.stringify(list)); } catch { /* a convenience */ }
}

interface State {
  userId: string | null;
  places: RecentPlace[];
  setUser: (userId: string | null) => void;
  visit: (place: Omit<RecentPlace, 'at'>) => void;
  clear: () => void;
}
export const useRecent = create<State>((set, get) => ({
  userId: null,
  places: [],
  setUser: (userId) => { if (userId !== get().userId) set({ userId, places: userId ? read(userId) : [] }); },
  visit: (place) => {
    const { userId, places } = get();
    if (!userId) return;
    const next = addRecent(places, place);
    if (next === places) return;
    set({ places: next });
    write(userId, next);
  },
  clear: () => { const { userId } = get(); set({ places: [] }); if (userId) write(userId, []); },
}));
