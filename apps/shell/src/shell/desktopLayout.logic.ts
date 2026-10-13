import { DESKTOP_MAX_COL, DESKTOP_MAX_ROW, type DesktopClient } from '@app/shared';

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
