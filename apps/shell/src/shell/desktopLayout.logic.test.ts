import { describe, expect, it } from 'vitest';
import { addWidget, defaultWidgets, hiddenWidgets, hideWidget, moveWidget, resolveWidgets, sizeWidget, gridSize, moveTo, neighbour, newShortcutId, phoneOrder, place, placePath, sameTarget, shiftPhone, shortcutKey, foldered, placeInFolder } from './desktopLayout.logic';
import { desktopClientSchema } from '@app/shared';

const keys = ['a', 'b', 'c', 'd', 'e'];

describe('place', () => {
  it('fills the two-column strip in order when nothing was moved', () => {
    const l = place(keys, {});
    expect(l.get('a')).toEqual({ col: 0, row: 0 });
    expect(l.get('b')).toEqual({ col: 1, row: 0 });
    expect(l.get('c')).toEqual({ col: 0, row: 1 });
    expect(l.get('e')).toEqual({ col: 0, row: 2 });
  });
  it('keeps saved places, and puts the rest in the first free cells', () => {
    const l = place(keys, { b: { col: 0, row: 0 } });
    expect(l.get('b')).toEqual({ col: 0, row: 0 });
    expect(l.get('a')).toEqual({ col: 1, row: 0 });
  });
  it('gives two items saved at one cell one of them, and the other a free cell', () => {
    const l = place(['a', 'b'], { a: { col: 3, row: 3 }, b: { col: 3, row: 3 } });
    expect(new Set([...l.values()].map((p) => `${p.col}:${p.row}`)).size).toBe(2);
  });
  it('ignores places off the grid and keys for apps that are not there', () => {
    const l = place(['a'], { a: { col: 99, row: 0 }, gone: { col: 1, row: 1 } });
    expect(l.get('a')).toEqual({ col: 0, row: 0 });
    expect(l.has('gone')).toBe(false);
  });
});

describe('moveTo', () => {
  it('moves into a free cell', () => {
    const out = moveTo(place(keys, {}), 'a', { col: 3, row: 2 });
    expect(out.a).toEqual({ col: 3, row: 2 });
    expect(out.b).toEqual({ col: 1, row: 0 });
  });
  it('swaps with whatever is in the cell', () => {
    const out = moveTo(place(keys, {}), 'a', { col: 1, row: 0 });
    expect(out.a).toEqual({ col: 1, row: 0 });
    expect(out.b).toEqual({ col: 0, row: 0 });
  });
  it('stays on the grid', () => {
    expect(moveTo(place(keys, {}), 'a', { col: -4, row: 500 }).a).toEqual({ col: 0, row: 39 });
  });
});

describe('neighbour and gridSize', () => {
  it('steps one cell and stops at the edge', () => {
    expect(neighbour({ col: 0, row: 0 }, 'left')).toBeNull();
    expect(neighbour({ col: 0, row: 0 }, 'right')).toEqual({ col: 1, row: 0 });
    expect(neighbour({ col: 5, row: 0 }, 'right')).toBeNull();
  });
  it('is the default strip until something is moved out, and one bigger while dragging', () => {
    const l = place(keys, {});
    expect(gridSize(l, false)).toEqual({ cols: 2, rows: 3 });
    expect(gridSize(l, true)).toEqual({ cols: 3, rows: 4 });
    expect(gridSize(new Map(Object.entries(moveTo(l, 'a', { col: 4, row: 0 }))), false).cols).toBe(5);
  });
});

describe('phone order', () => {
  const items = keys.map((id) => ({ id }));
  it('puts the saved order first and the rest after it', () => {
    expect(phoneOrder(items, ['c', 'a', 'nope']).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
  });
  it('moves one earlier or later, and stops at the ends', () => {
    expect(shiftPhone(items, [], 'c', -1)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(shiftPhone(items, [], 'a', -1)).toEqual(keys);
    expect(shiftPhone(items, [], 'e', 1)).toEqual(keys);
  });
});

describe('shortcuts', () => {
  it('keys shortcuts apart from apps and places them like any icon', () => {
    expect(shortcutKey('s_abc123')).toBe('sc:s_abc123');
    const l = place(['boards', shortcutKey('s_abc123')], { 'sc:s_abc123': { col: 3, row: 2 } });
    expect(l.get('sc:s_abc123')).toEqual({ col: 3, row: 2 });
    expect(l.get('boards')).toEqual({ col: 0, row: 0 });
  });
  it('knows when two shortcuts point at the same thing', () => {
    expect(sameTarget({ type: 'bookmark', bookmark_id: 'bm_1' }, { type: 'bookmark', bookmark_id: 'bm_1' })).toBe(true);
    expect(sameTarget({ type: 'bookmark', bookmark_id: 'bm_1' }, { type: 'bookmark', bookmark_id: 'bm_2' })).toBe(false);
    expect(sameTarget({ type: 'place', app: 'boards', path: 'a' }, { type: 'place', app: 'boards', path: 'a' })).toBe(true);
    expect(sameTarget({ type: 'place', app: 'boards', path: 'a' }, { type: 'place', app: 'wiki', path: 'a' })).toBe(false);
    expect(sameTarget({ type: 'place', app: 'boards', path: '' }, { type: 'bookmark', bookmark_id: 'bm_1' })).toBe(false);
  });
  it('keeps only a plain place from a window path', () => {
    expect(placePath('general/t/p_123')).toBe('general/t/p_123');
    expect(placePath('/wiki/page/')).toBe('wiki/page');
    expect(placePath('add?url=https://x.example&title=y')).toBe('add');
    expect(placePath('a//b')).toBe('');
    expect(placePath('../admin')).toBe('');
    expect(placePath('javascript:alert(1)')).toBe('');
  });
  it('makes ids the server accepts', () => {
    expect(newShortcutId()).toMatch(/^s_[a-z0-9]{6,20}$/);
  });
});

describe('home panel widgets', () => {
  it('follows the default list until the person changes it, and honours the old Getting-started flag', () => {
    expect(resolveWidgets({ widgets: [], widgets_set: false }).map((w) => w.id)).toEqual(defaultWidgets().map((w) => w.id));
    expect(resolveWidgets({ widgets: [], widgets_set: false }, true).map((w) => w.id)).not.toContain('start');
    expect(resolveWidgets({ widgets: [{ id: 'memos', size: 'wide' }], widgets_set: true })).toEqual([{ id: 'memos', size: 'wide' }]);
  });
  it('moves, resizes, hides and adds', () => {
    const d = defaultWidgets();
    expect(moveWidget(d, 'start', 1).slice(0, 3).map((w) => w.id)).toEqual(['stats', 'wall', 'start']);
    expect(moveWidget(d, 'stats', -1)).toBe(d);
    expect(moveWidget(d, 'links', 1)).toBe(d);
    expect(sizeWidget(d, 'memos', 'wide').find((w) => w.id === 'memos')!.size).toBe('wide');
    const without = hideWidget(d, 'tower');
    expect(without.some((w) => w.id === 'tower')).toBe(false);
    expect(hiddenWidgets(without)).toEqual(['tower']);
    expect(addWidget(without, 'tower').at(-1)).toEqual({ id: 'tower', size: 'normal' });
    expect(addWidget(d, 'tower')).toBe(d);
  });
});

describe('folders', () => {
  const folders = [{ id: 'f_aaaaaa', name: 'A', items: ['boards'] }, { id: 'f_bbbbbb', name: 'B', items: [] as string[] }];
  it('moves an item from one folder to another, or out of all of them', () => {
    const moved = placeInFolder(folders, 'boards', 'f_bbbbbb');
    expect(moved.map((f) => f.items)).toEqual([[], ['boards']]);
    expect(placeInFolder(moved, 'boards', null).flatMap((f) => f.items)).toEqual([]);
    expect([...foldered({ folders })]).toEqual(['boards']);
  });
  it('the saved document refuses an item in two folders', () => {
    expect(desktopClientSchema.safeParse({ folders: [{ id: 'f_aaaaaa', name: 'A', items: ['mail'] }, { id: 'f_bbbbbb', name: 'B', items: ['mail'] }] }).success).toBe(false);
    expect(desktopClientSchema.safeParse({ folders }).success).toBe(true);
  });
});
