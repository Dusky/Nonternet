// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clampGeometry, focusedWindow, MIN_H, MIN_W, TASKBAR_HEIGHT, useWindows } from './windows';

const V = { w: 1200, h: 800 };
const store = () => useWindows.getState();
const win = (id: 'settings' | 'admin') => store().wins.find((w) => w.id === id)!;

beforeEach(() => {
  window.localStorage.clear();
  useWindows.setState({ wins: [], zTop: 1, viewport: V });
});

describe('where the app in a window is', () => {
  it('starts at the place it was opened at, and keeps it when opened again without one', () => {
    store().open('settings', 'password');
    expect(win('settings').path).toBe('password');
    store().open('settings');
    expect(win('settings').path).toBe('password');
    store().open('settings', 'profile');
    expect(win('settings').path).toBe('profile');
    expect(store().wins).toHaveLength(1);
  });
  it('is changed by setPath', () => {
    store().open('admin');
    expect(win('admin').path).toBe('');
    store().setPath('admin', 'audit');
    expect(win('admin').path).toBe('audit');
  });
});

describe('opening and focusing', () => {
  it('opens one window per app, and opening again brings it forward instead of duplicating it', () => {
    store().open('settings');
    store().open('admin');
    store().open('settings');
    expect(store().wins).toHaveLength(2);
    expect(focusedWindow(store().wins)!.id).toBe('settings');
  });

  it('cascades new windows so they do not sit exactly on top of each other', () => {
    store().open('settings');
    store().open('admin');
    expect(win('admin').x).toBeGreaterThan(win('settings').x);
    expect(win('admin').y).toBeGreaterThan(win('settings').y);
  });

  it('puts the most recently focused window on top', () => {
    store().open('settings');
    store().open('admin');
    expect(win('admin').z).toBeGreaterThan(win('settings').z);
    store().focus('settings');
    expect(win('settings').z).toBeGreaterThan(win('admin').z);
  });

  it('brings a minimized window back when it is focused or opened', () => {
    store().open('settings');
    store().minimize('settings');
    expect(win('settings').minimized).toBe(true);
    store().open('settings');
    expect(win('settings').minimized).toBe(false);
    store().minimize('settings');
    store().focus('settings');
    expect(win('settings').minimized).toBe(false);
  });

  it('gives focus to the next window when the top one is minimized or closed', () => {
    store().open('settings');
    store().open('admin');
    store().minimize('admin');
    expect(focusedWindow(store().wins)!.id).toBe('settings');
    store().close('settings');
    expect(focusedWindow(store().wins)).toBeUndefined(); // only the minimized admin window is left
    store().close('admin');
    expect(store().wins).toEqual([]);
  });
});

describe('maximizing', () => {
  it('fills the desktop above the taskbar, and restores the old place and size', () => {
    store().open('settings');
    store().move('settings', 200, 120);
    const before = { x: win('settings').x, y: win('settings').y, w: win('settings').w, h: win('settings').h };
    store().toggleMaximize('settings');
    expect(win('settings')).toMatchObject({ x: 0, y: 0, w: V.w, h: V.h - TASKBAR_HEIGHT, maximized: true });
    store().toggleMaximize('settings');
    expect(win('settings')).toMatchObject({ ...before, maximized: false });
  });

  it('ignores moving and resizing while maximized', () => {
    store().open('settings');
    store().toggleMaximize('settings');
    store().move('settings', 300, 300);
    store().resize('settings', { x: 10, y: 10, w: 400, h: 400 });
    expect(win('settings')).toMatchObject({ x: 0, y: 0, w: V.w });
  });
});

describe('snapping and cycling', () => {
  it('snaps a window to half the desktop, and maximizing then restoring puts it back where it was before', () => {
    store().open('settings');
    store().move('settings', 200, 120);
    const before = { x: win('settings').x, y: win('settings').y, w: win('settings').w, h: win('settings').h };
    store().snap('settings', 'right');
    expect(win('settings')).toMatchObject({ x: V.w / 2, y: 0, w: V.w / 2, h: V.h - TASKBAR_HEIGHT, maximized: false });
    store().snap('settings', 'left');
    expect(win('settings')).toMatchObject({ x: 0, w: V.w / 2 });
    store().toggleMaximize('settings');
    store().toggleMaximize('settings');
    expect(win('settings')).toMatchObject({ ...before, maximized: false });
  });

  it('moving a snapped window by hand forgets the snap', () => {
    store().open('settings');
    store().snap('settings', 'left');
    store().move('settings', 100, 100);
    expect(win('settings').restore).toBeNull();
  });

  it('cycles through every window, minimized ones too, like Alt+Tab', () => {
    store().open('settings');
    store().open('admin');
    store().minimize('settings');
    expect(store().cycle()).toBe('settings');
    expect(focusedWindow(store().wins)?.id).toBe('settings');
    expect(win('settings').minimized).toBe(false);
    expect(store().cycle()).toBe('admin');
    expect(store().cycle()).toBe('settings');
  });

  it('has nothing to cycle to with no windows', () => {
    expect(store().cycle()).toBeNull();
  });
});

describe('keeping windows usable', () => {
  it('never lets a window get smaller than the minimum', () => {
    store().open('settings');
    store().resize('settings', { x: 50, y: 50, w: 10, h: 10 });
    expect(win('settings').w).toBe(MIN_W);
    expect(win('settings').h).toBe(MIN_H);
  });

  it('never lets a window be bigger than the desktop', () => {
    store().open('settings');
    store().resize('settings', { x: 0, y: 0, w: 9999, h: 9999 });
    expect(win('settings').w).toBe(V.w);
    expect(win('settings').h).toBe(V.h - TASKBAR_HEIGHT);
  });

  it('keeps part of the title bar on screen so the window can always be grabbed', () => {
    store().open('settings');
    store().move('settings', -5000, -5000);
    expect(win('settings').x + win('settings').w).toBeGreaterThanOrEqual(96);
    expect(win('settings').y).toBe(0);
    store().move('settings', 99999, 99999);
    expect(win('settings').x).toBeLessThanOrEqual(V.w - 96);
    expect(win('settings').y).toBeLessThanOrEqual(V.h - TASKBAR_HEIGHT - 40);
  });

  it('pulls windows back in when the browser window is made smaller', () => {
    store().open('settings');
    store().move('settings', 900, 500);
    store().setViewport({ w: 600, h: 500 });
    const w = win('settings');
    expect(w.x).toBeLessThanOrEqual(600 - 96);
    expect(w.w).toBeLessThanOrEqual(600);
    expect(w.y).toBeLessThanOrEqual(500 - TASKBAR_HEIGHT - 40);
  });

  it('clamps a geometry on its own (pure function)', () => {
    expect(clampGeometry({ x: 0, y: 0, w: 100, h: 100 }, V)).toMatchObject({ w: MIN_W, h: MIN_H });
    expect(clampGeometry({ x: 20, y: 30, w: 500, h: 400 }, V)).toEqual({ x: 20, y: 30, w: 500, h: 400 });
  });
});

describe('remembering positions', () => {
  it('reopens a window where it was left', () => {
    store().open('settings');
    store().move('settings', 333, 111);
    store().resize('settings', { x: 333, y: 111, w: 500, h: 420 });
    store().close('settings');
    store().open('settings');
    expect(win('settings')).toMatchObject({ x: 333, y: 111, w: 500, h: 420 });
  });

  it('does not remember a maximized size', () => {
    store().open('settings');
    store().toggleMaximize('settings');
    store().move('settings', 5, 5);
    store().close('settings');
    store().open('settings');
    expect(win('settings').w).toBeLessThan(V.w);
  });

  it('still works when storage is unavailable or holds junk', () => {
    window.localStorage.setItem('ui:windows:v1', '{not json');
    store().open('settings');
    expect(win('settings').w).toBeGreaterThanOrEqual(MIN_W);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    try {
      expect(() => store().move('settings', 100, 100)).not.toThrow();
    } finally { Storage.prototype.setItem = original; }
  });
});
