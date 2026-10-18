import { DESKTOP_MAX_COL, DESKTOP_MAX_ROW, WIDGET_IDS, type DesktopClient, type DesktopShortcut, type WidgetChoice, type WidgetId } from '@app/shared';

// Where icons sit on the desktop grid (docs/10). Pure functions, so the rules are easy to test: saved positions are kept,
// anything without a (free) place fills the first free cells in the default order, and a drop on an occupied cell swaps.

export type Pos = { col: number; row: number };
export const DEFAULT_COLS = 2; // the strip beside the home panel, as it has always been

const same = (a: Pos, b: Pos) => a.col === b.col && a.row === b.row;
const keyOf = (p: Pos) => `${p.col}:${p.row}`;
const inside = (p: Pos) => p.col >= 0 && p.col <= DESKTOP_MAX_COL && p.row >= 0 && p.row <= DESKTOP_MAX_ROW;

// Every item's cell. Items are in default order; `saved` is what the person arranged.
export function place(keys: string[], saved: DesktopClient['positions']): Map<string, Pos> {
  const out = new Map<string, Pos>();
  const taken = new Set<string>();
  for (const k of keys) {
    const p = saved[k];
    if (p && inside(p) && !taken.has(keyOf(p))) { out.set(k, p); taken.add(keyOf(p)); }
  }
  let i = 0;
  for (const k of keys) {
    if (out.has(k)) continue;
    let p: Pos;
    do { p = { col: i % DEFAULT_COLS, row: Math.floor(i / DEFAULT_COLS) }; i++; } while (taken.has(keyOf(p)));
    out.set(k, p);
    taken.add(keyOf(p));
  }
  return out;
}

// Move an item to a cell. An item already there changes places with it. Returns every item's explicit position.
export function moveTo(layout: Map<string, Pos>, key: string, to: Pos): Record<string, Pos> {
  const here = layout.get(key);
  const target = { col: Math.max(0, Math.min(DESKTOP_MAX_COL, to.col)), row: Math.max(0, Math.min(DESKTOP_MAX_ROW, to.row)) };
  const out: Record<string, Pos> = {};
  for (const [k, p] of layout) out[k] = p;
  if (!here) return out;
  for (const [k, p] of layout) if (k !== key && same(p, target)) out[k] = here;
  out[key] = target;
  return out;
}

export type Dir = 'left' | 'right' | 'up' | 'down';
export const DIRS: Dir[] = ['left', 'right', 'up', 'down'];

// One cell in a direction, or null at the edge.
export function neighbour(p: Pos, dir: Dir): Pos | null {
  const n = { left: { col: p.col - 1, row: p.row }, right: { col: p.col + 1, row: p.row }, up: { col: p.col, row: p.row - 1 }, down: { col: p.col, row: p.row + 1 } }[dir];
  return inside(n) ? n : null;
}

// How many columns and rows to draw: enough for every item, never fewer than the default strip, and one more of each
// while something is being dragged so there is somewhere to drop it.
export function gridSize(layout: Map<string, Pos>, dragging: boolean): { cols: number; rows: number } {
  let cols = DEFAULT_COLS; let rows = 1;
  for (const p of layout.values()) { cols = Math.max(cols, p.col + 1); rows = Math.max(rows, p.row + 1); }
  return dragging ? { cols: Math.min(DESKTOP_MAX_COL + 1, cols + 1), rows: Math.min(DESKTOP_MAX_ROW + 1, rows + 1) } : { cols, rows };
}

// Phones: the saved order first, then everything else in the default order.
export function phoneOrder<T extends { id: string }>(items: T[], saved: string[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const first = saved.map((id) => byId.get(id)).filter((i): i is T => Boolean(i));
  const seen = new Set(first.map((i) => i.id));
  return [...first, ...items.filter((i) => !seen.has(i.id))];
}

// Move one entry earlier or later in the phone order (the order is made explicit for everyone first).
export function shiftPhone(items: { id: string }[], saved: string[], id: string, by: -1 | 1): string[] {
  const ids = phoneOrder(items, saved).map((i) => i.id);
  const at = ids.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= ids.length) return ids;
  [ids[at], ids[to]] = [ids[to]!, ids[at]!];
  return ids;
}

export const NEVER_HIDDEN = ['settings'];

// Shortcuts: an icon that opens a bookmark or a place inside an app. On the grid it is keyed 'sc:<id>' (apps use their own id).
export const shortcutKey = (id: string) => `sc:${id}`;
export type ShortcutTarget = DesktopShortcut['target'];
export const sameTarget = (a: ShortcutTarget, b: ShortcutTarget): boolean =>
  a.type === 'bookmark' ? b.type === 'bookmark' && a.bookmark_id === b.bookmark_id : b.type === 'place' && a.app === b.app && a.path === b.path;
// A window's current screen as a place the server accepts: no query, no leading slash; anything odd means "the app's first screen".
export function placePath(path: string): string {
  const p = (path.split(/[?#]/)[0] ?? '').replace(/^\/+|\/+$/g, '');
  return p.length <= 300 && /^[A-Za-z0-9._~:@%+/-]*$/.test(p) && !p.includes('//') && !p.includes('..') ? p : '';
}
export const folderKey = (id: string) => `fd:${id}`;
// The item keys inside folders: they are not on the desktop grid or the phone grid themselves.
export const foldered = (s: Pick<DesktopClient, 'folders'>): Set<string> => new Set(s.folders.flatMap((f) => f.items));
// Puts an item in a folder (taking it out of any other), or takes it out of all of them when `folderId` is null.
export function placeInFolder(folders: DesktopClient['folders'], key: string, folderId: string | null): DesktopClient['folders'] {
  return folders.map((f) => ({ ...f, items: f.id === folderId ? [...f.items.filter((k) => k !== key), key] : f.items.filter((k) => k !== key) }));
}
export const newFolderId = (): string => `f_${Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')}`;
export const newShortcutId = (): string => `s_${Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')}`;

// Home panel widgets. Untouched accounts follow the default list (so a widget added later reaches them); once someone changes
// anything the list is theirs. 'start' (Getting started) used to be hidden by a flag kept on the device: that still counts.
const WIDE_BY_DEFAULT: WidgetId[] = ['stats', 'start', 'links'];
export const defaultWidgets = (): WidgetChoice[] => WIDGET_IDS.map((id) => ({ id, size: WIDE_BY_DEFAULT.includes(id) ? 'wide' : 'normal' }));
export function resolveWidgets(s: Pick<DesktopClient, 'widgets' | 'widgets_set'>, legacyStartHidden = false): WidgetChoice[] {
  if (s.widgets_set) return s.widgets;
  return defaultWidgets().filter((w) => !(legacyStartHidden && w.id === 'start'));
}
// Each of these takes the current list and gives the new one.
export function moveWidget(list: WidgetChoice[], id: WidgetId, by: -1 | 1): WidgetChoice[] {
  const i = list.findIndex((w) => w.id === id); const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list]; [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}
export const sizeWidget = (list: WidgetChoice[], id: WidgetId, size: WidgetChoice['size']): WidgetChoice[] => list.map((w) => (w.id === id ? { ...w, size } : w));
export const hideWidget = (list: WidgetChoice[], id: WidgetId): WidgetChoice[] => list.filter((w) => w.id !== id);
export const addWidget = (list: WidgetChoice[], id: WidgetId): WidgetChoice[] =>
  list.some((w) => w.id === id) ? list : [...list, { id, size: defaultWidgets().find((w) => w.id === id)!.size }];
export const hiddenWidgets = (list: WidgetChoice[]): WidgetId[] => WIDGET_IDS.filter((id) => !list.some((w) => w.id === id));
