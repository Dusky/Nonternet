import { describe, expect, it } from 'vitest';
import { gridSize, moveTo, neighbour, phoneOrder, place, shiftPhone } from './desktopLayout.logic';

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
