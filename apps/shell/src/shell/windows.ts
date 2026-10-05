import { create } from 'zustand';

// The window manager (docs/10): desktop-style windows on large screens. This file is only the
// state and the rules; it draws nothing, so the rules can be tested on their own.

export type BuiltinAppId = 'boards' | 'wiki' | 'rings' | 'people' | 'mail' | 'files' | 'chat' | 'terminal' | 'mud' | 'homepages' | 'studio' | 'addapps' | 'notifications' | 'settings' | 'admin';
// An app someone added (docs/10) is `app:` and its id from the catalog.
export type AppId = BuiltinAppId | `app:${string}`;

export interface Win {
  id: AppId;
  x: number; y: number; w: number; h: number;
  z: number;
  // Where the app inside the window is ("general/t/p_…"). Kept here so another app can open a window at a place.
  path: string;
  // Where this window has been, so it has its own Back and Forward (M9-B). `cursor` is the entry shown now.
  history: string[];
  cursor: number;
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

// ---------------------------------------------------------------- resizing and snapping (pure)
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// The window's new place when one edge or corner is dragged by (dx, dy). The opposite edge stays put: when
// the window hits its minimum size the dragged edge stops rather than the window sliding away.
export function resizeFrom(edge: Edge, start: Geometry, dx: number, dy: number): Geometry {
  let { x, y, w, h } = start;
  if (edge.includes('e')) w = start.w + dx;
  if (edge.includes('s')) h = start.h + dy;
  if (edge.includes('w')) { w = start.w - dx; x = start.x + dx; }
  if (edge.includes('n')) { h = start.h - dy; y = start.y + dy; }
  if (w < MIN_W) { if (edge.includes('w')) x = start.x + start.w - MIN_W; w = MIN_W; }
  if (h < MIN_H) { if (edge.includes('n')) y = start.y + start.h - MIN_H; h = MIN_H; }
  return { x, y, w, h };
}

export type SnapZone = 'left' | 'right' | 'max' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type SnapSide = Exclude<SnapZone, 'max'>;
const SNAP_MARGIN = 6;
const CORNER = 48;

// Where a window being dragged will land if let go with the pointer here: in a corner of the screen it takes
// that quarter, against the left or right edge that half, against the top edge it fills the desktop. Null elsewhere.
export function snapZone(pointer: { x: number; y: number }, v: Viewport): SnapZone | null {
  const left = pointer.x <= SNAP_MARGIN || (pointer.x <= CORNER && pointer.y <= TASKBAR_HEIGHT + SNAP_MARGIN);
  const right = pointer.x >= v.w - SNAP_MARGIN || (pointer.x >= v.w - CORNER && pointer.y <= TASKBAR_HEIGHT + SNAP_MARGIN);
  const top = pointer.y <= TASKBAR_HEIGHT + CORNER;
  const bottom = pointer.y >= v.h - CORNER;
  if (left && top) return 'top-left';
  if (right && top) return 'top-right';
  if (left && bottom) return 'bottom-left';
  if (right && bottom) return 'bottom-right';
  if (pointer.y <= TASKBAR_HEIGHT + SNAP_MARGIN) return 'max';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

// The place a snap zone gives a window: a quarter, a half, or all of the desktop.
export function snapGeometry(zone: SnapZone, v: Viewport): Geometry {
  const a = area(v);
  if (zone === 'max') return { x: 0, y: 0, w: a.w, h: a.h };
  const half = Math.max(Math.floor(a.w / 2), Math.min(MIN_W, a.w));
  const x = zone.endsWith('left') ? 0 : a.w - half;
  if (zone === 'left' || zone === 'right') return { x, y: 0, w: half, h: a.h };
  const halfH = Math.max(Math.floor(a.h / 2), Math.min(MIN_H, a.h));
  return { x, y: zone.startsWith('top') ? 0 : a.h - halfH, w: half, h: halfH };
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
  setPath(id: AppId, path: string, replace?: boolean): void;
  back(id: AppId): void;
  forward(id: AppId): void;
  setSnapPreview(zone: SnapZone | null): void;
  snapPreview: SnapZone | null;
  subtitles: Partial<Record<AppId, string>>;
  setSubtitle(id: AppId, text: string | null): void;
  close(id: AppId): void;
  focus(id: AppId): void;
  minimize(id: AppId): void;
  toggleMaximize(id: AppId): void;
  snap(id: AppId, side: SnapSide): void;
  cycle(): AppId | null;
  move(id: AppId, x: number, y: number): void;
  resize(id: AppId, geometry: Geometry): void;
  reset(): void;
}

const MAX_HISTORY = 50;
const goTo = (w: Win, path: string): Pick<Win, 'path' | 'history' | 'cursor'> => {
  if (path === w.path) return { path, history: w.history, cursor: w.cursor };
  const history = [...w.history.slice(0, w.cursor + 1), path].slice(-MAX_HISTORY);
  return { path, history, cursor: history.length - 1 };
};
const replaceCurrent = (w: Win, path: string): Pick<Win, 'path' | 'history' | 'cursor'> => {
  const history = [...w.history];
  history[w.cursor] = path;
  return { path, history, cursor: w.cursor };
};

const topVisible = (wins: Win[]) => [...wins].filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0];

export const useWindows = create<State>((set, get) => ({
  wins: [],
  zTop: 1,
  viewport: { w: 1280, h: 800 },
  snapPreview: null,
  subtitles: {},
  setSnapPreview: (snapPreview) => set({ snapPreview }),
  setSubtitle: (id, text) => set((s) => {
    if ((s.subtitles[id] ?? null) === text) return s;
    const subtitles = { ...s.subtitles };
    if (text) subtitles[id] = text; else delete subtitles[id];
    return { subtitles };
  }),

  setViewport: (viewport) => set((s) => ({
    viewport,
    // A window that no longer fits (the browser was made smaller) is pulled back in.
    wins: s.wins.map((w) => (w.maximized ? w : { ...w, ...clampGeometry(w, viewport) })),
  })),

  open: (id, path) => set((s) => {
    const existing = s.wins.find((w) => w.id === id);
    const z = s.zTop + 1;
    // One window per app: opening it again brings it back and to the front. Given a place, it goes there.
    if (existing) return { zTop: z, wins: s.wins.map((w) => (w.id === id ? { ...w, minimized: false, z, ...(path !== undefined && path !== w.path ? goTo(w, path) : {}) } : w)) };
    const cascade = s.wins.length * 28;
    const saved = loadSaved()[id];
    // New windows open to the right of the desktop icons, so the icons stay in reach.
    const g = clampGeometry(saved ?? { x: ICONS_W + cascade, y: 24 + cascade, ...DEFAULT }, s.viewport);
    return { zTop: z, wins: [...s.wins, { id, ...g, z, path: path ?? '', history: [path ?? ''], cursor: 0, minimized: false, maximized: false, restore: null }] };
  }),

  // Moving to a new place adds to the window's history (dropping any "forward" part), unless it replaces
  // the current place (a redirect, the first screen of an app).
  setPath: (id, path, replace = false) => set((s) => ({ wins: s.wins.map((w) => (w.id === id ? { ...w, ...(replace ? replaceCurrent(w, path) : goTo(w, path)) } : w)) })),

  back: (id) => set((s) => ({ wins: s.wins.map((w) => (w.id === id && w.cursor > 0 ? { ...w, cursor: w.cursor - 1, path: w.history[w.cursor - 1]! } : w)) })),
  forward: (id) => set((s) => ({ wins: s.wins.map((w) => (w.id === id && w.cursor < w.history.length - 1 ? { ...w, cursor: w.cursor + 1, path: w.history[w.cursor + 1]! } : w)) })),

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

  // Fill a half or a quarter of the desktop. Un-maximizing (or snapping again) puts it back.
  snap: (id, side) => set((s) => {
    const z = s.zTop + 1;
    const g = snapGeometry(side, s.viewport);
    return {
      zTop: z,
      wins: s.wins.map((w) => (w.id !== id ? w : { ...w, ...g, maximized: false, minimized: false, z, restore: w.restore ?? { x: w.x, y: w.y, w: w.w, h: w.h } })),
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

// ---------------------------------------------------------------- remembering what was open (M9-B)
// Reloading the page, or coming back tomorrow, reopens the same windows in the same order, each at the place
// it was in its app. Kept per person, and cleared at logout so the next person at a shared screen starts clean.
const SESSION_KEY = 'ui:session:v1';
interface SavedWindow { id: AppId; path: string; minimized: boolean; maximized: boolean }
interface SavedSession { user: string; wins: SavedWindow[] }

export function saveSession(userId: string): void {
  try {
    const wins = [...useWindows.getState().wins].sort((a, b) => a.z - b.z).map((w): SavedWindow => ({ id: w.id, path: w.path, minimized: w.minimized, maximized: w.maximized }));
    const session: SavedSession = { user: userId, wins };
    safeStorage()?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* a convenience, never an error */ }
}

export function clearSession(): void {
  try { safeStorage()?.removeItem(SESSION_KEY); } catch { /* nothing to clear */ }
}

// Reopens the saved windows for this person. `valid` says which apps still exist and may be shown to them
// (an app can be switched off, or be admin-only); anything else is skipped. Does nothing if windows are open.
export function restoreSession(userId: string, valid: (id: AppId) => boolean): number {
  if (useWindows.getState().wins.length > 0) return 0;
  let saved: SavedSession | null = null;
  try { saved = JSON.parse(safeStorage()?.getItem(SESSION_KEY) ?? 'null') as SavedSession | null; } catch { return 0; }
  if (!saved || saved.user !== userId || !Array.isArray(saved.wins)) return 0;
  const s = useWindows.getState();
  let n = 0;
  for (const w of saved.wins.slice(0, 40)) { // a generous cap: built-in apps plus the ones someone added
    if (!w || typeof w.id !== 'string' || !valid(w.id) || typeof w.path !== 'string' || w.path.length > 300) continue;
    s.open(w.id, w.path);
    if (w.maximized) s.toggleMaximize(w.id);
    if (w.minimized) s.minimize(w.id);
    n++;
  }
  return n;
}
