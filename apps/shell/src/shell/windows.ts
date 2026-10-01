import { create } from 'zustand';

// The window manager (docs/10): desktop-style windows on large screens. This file is only the
// state and the rules; it draws nothing, so the rules can be tested on their own.

export type AppId = 'boards' | 'rings' | 'people' | 'mail' | 'files' | 'chat' | 'terminal' | 'mud' | 'homepages' | 'studio' | 'notifications' | 'settings' | 'admin';

export interface Win {
  id: AppId;
  x: number; y: number; w: number; h: number;
  z: number;
  // Where the app inside the window is ("general/t/p_…"). Kept here so another app can open a window at a place.
  path: string;
  minimized: boolean;
  maximized: boolean;
  // Where the window sits when it is not maximized, so un-maximizing puts it back.
  restore: { x: number; y: number; w: number; h: number } | null;
}
export interface Viewport { w: number; h: number }

export const TASKBAR_HEIGHT = 48;
export const MIN_W = 320;
export const MIN_H = 240;
const DEFAULT = { w: 780, h: 560 };
const ICONS_W = 232;
const STORAGE_KEY = 'ui:windows:v1';

type Geometry = Pick<Win, 'x' | 'y' | 'w' | 'h'>;

// The desktop is the viewport minus the taskbar.
const area = (v: Viewport) => ({ w: v.w, h: Math.max(v.h - TASKBAR_HEIGHT, MIN_H) });

// Keep a window usable: never smaller than the minimum or bigger than the desktop, and always with
// enough of its title bar on screen to grab it.
export function clampGeometry(g: Geometry, v: Viewport): Geometry {
  const a = area(v);
  const w = Math.min(Math.max(g.w, Math.min(MIN_W, a.w)), a.w);
  const h = Math.min(Math.max(g.h, Math.min(MIN_H, a.h)), a.h);
  const grab = 96;
  return { w, h, x: Math.min(Math.max(g.x, grab - w), a.w - grab), y: Math.min(Math.max(g.y, 0), a.h - 40) };
}

const safeStorage = () => {
  try { return window.localStorage; } catch { return null; }
};
function loadSaved(): Partial<Record<AppId, Geometry>> {
  try {
    const raw = safeStorage()?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<AppId, Geometry>>) : {};
  } catch { return {}; }
}
function save(wins: Win[]) {
  try {
    const saved = loadSaved();
    for (const w of wins) if (!w.maximized) saved[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h };
    safeStorage()?.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch { /* remembering positions is a convenience, never an error */ }
}

interface State {
  wins: Win[];
  zTop: number;
  viewport: Viewport;
  setViewport(v: Viewport): void;
  open(id: AppId, path?: string): void;
  setPath(id: AppId, path: string): void;
  close(id: AppId): void;
  focus(id: AppId): void;
  minimize(id: AppId): void;
  toggleMaximize(id: AppId): void;
  snap(id: AppId, side: 'left' | 'right'): void;
  cycle(): AppId | null;
  move(id: AppId, x: number, y: number): void;
  resize(id: AppId, geometry: Geometry): void;
  reset(): void;
}

const topVisible = (wins: Win[]) => [...wins].filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];

export const useWindows = create<State>((set, get) => ({
  wins: [],
  zTop: 1,
  viewport: { w: 1280, h: 800 },

  setViewport: (viewport) => set((s) => ({
    viewport,
    // A window that no longer fits (the browser was made smaller) is pulled back in.
    wins: s.wins.map((w) => (w.maximized ? w : { ...w, ...clampGeometry(w, viewport) })),
  })),

  open: (id, path) => set((s) => {
    const existing = s.wins.find((w) => w.id === id);
    const z = s.zTop + 1;
    // One window per app: opening it again brings it back and to the front. Given a place, it goes there.
    if (existing) return { zTop: z, wins: s.wins.map((w) => (w.id === id ? { ...w, minimized: false, z, path: path ?? w.path } : w)) };
    const cascade = s.wins.length * 28;
    const saved = loadSaved()[id];
    // New windows open to the right of the desktop icons, so the icons stay in reach.
    const g = clampGeometry(saved ?? { x: ICONS_W + cascade, y: 24 + cascade, ...DEFAULT }, s.viewport);
    return { zTop: z, wins: [...s.wins, { id, ...g, z, path: path ?? '', minimized: false, maximized: false, restore: null }] };
  }),

  setPath: (id, path) => set((s) => ({ wins: s.wins.map((w) => (w.id === id ? { ...w, path } : w)) })),

  close: (id) => set((s) => ({ wins: s.wins.filter((w) => w.id !== id) })),

  focus: (id) => set((s) => {
    const z = s.zTop + 1;
    return { zTop: z, wins: s.wins.map((w) => (w.id === id ? { ...w, minimized: false, z } : w)) };
  }),

  minimize: (id) => set((s) => ({ wins: s.wins.map((w) => (w.id === id ? { ...w, minimized: true } : w)) })),

  toggleMaximize: (id) => set((s) => {
    const a = area(s.viewport);
    const z = s.zTop + 1;
    return {
      zTop: z,
      wins: s.wins.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) return { ...w, ...(w.restore ?? clampGeometry(w, s.viewport)), maximized: false, restore: null, z };
        // A snapped window keeps the place it had before it was snapped.
        return { ...w, x: 0, y: 0, w: a.w, h: a.h, maximized: true, restore: w.restore ?? { x: w.x, y: w.y, w: w.w, h: w.h }, z };
      }),
    };
  }),

  // Fill the left or right half of the desktop. Un-maximizing (or snapping again) puts it back.
  snap: (id, side) => set((s) => {
    const a = area(s.viewport);
    const z = s.zTop + 1;
    const half = Math.max(Math.floor(a.w / 2), Math.min(MIN_W, a.w));
    return {
      zTop: z,
      wins: s.wins.map((w) => (w.id !== id ? w : {
        ...w, x: side === 'left' ? 0 : a.w - half, y: 0, w: half, h: a.h, maximized: false, minimized: false, z,
        restore: w.restore ?? { x: w.x, y: w.y, w: w.w, h: w.h },
      })),
    };
  }),

  // The next window to the front, like Alt+Tab: the one at the back comes forward, so pressing it
  // again goes through every window, minimized ones included. Returns the window now in front.
  cycle: () => {
    const { wins } = get();
    if (wins.length === 0) return null;
    const front = topVisible(wins);
    const back = [...wins].sort((a, b) => a.z - b.z).find((w) => w.id !== front?.id) ?? wins[0]!;
    get().focus(back.id);
    return back.id;
  },

  move: (id, x, y) => {
    set((s) => ({ wins: s.wins.map((w) => (w.id === id && !w.maximized ? { ...w, ...clampGeometry({ ...w, x, y }, s.viewport), restore: null } : w)) }));
    save(get().wins);
  },

  resize: (id, geometry) => {
    set((s) => ({ wins: s.wins.map((w) => (w.id === id && !w.maximized ? { ...w, ...clampGeometry(geometry, s.viewport) } : w)) }));
    save(get().wins);
  },

  reset: () => set({ wins: [], zTop: 1 }),
}));

// The window that has focus: the topmost one that is not minimized.
export const focusedWindow = (wins: Win[]): Win | undefined => topVisible(wins);
