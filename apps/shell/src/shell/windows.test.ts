// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clampGeometry, clearSession, resizeFrom, snapGeometry, snapZone, focusedWindow, MIN_H, MIN_W, restoreSession, saveSession, TASKBAR_HEIGHT, useWindows } from './windows';

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

describe('remembering what was open', () => {
  const all = () => true;
  it('reopens the same windows, in the same order, at the same place in each app', () => {
    store().open('settings', 'appearance');
    store().open('admin', 'users');
    store().focus('settings');
    saveSession('u_1');
    useWindows.setState({ wins: [], zTop: 1 });
    expect(restoreSession('u_1', all)).toBe(2);
    expect(win('settings').path).toBe('appearance');
    expect(win('admin').path).toBe('users');
    expect(focusedWindow(store().wins)?.id).toBe('settings');
  });

  it('brings back maximized and minimized windows as they were', () => {
    store().open('settings');
    store().open('admin');
    store().toggleMaximize('admin');
    store().minimize('settings');
    saveSession('u_1');
    useWindows.setState({ wins: [], zTop: 1 });
    restoreSession('u_1', all);
    expect(win('admin').maximized).toBe(true);
    expect(win('settings').minimized).toBe(true);
  });

  it('is for one person only, and logging out clears it', () => {
    store().open('settings');
    saveSession('u_1');
    useWindows.setState({ wins: [], zTop: 1 });
    expect(restoreSession('u_2', all)).toBe(0);
    clearSession();
    expect(restoreSession('u_1', all)).toBe(0);
  });

  it('skips apps that are no longer there, and does nothing when windows are already open', () => {
    store().open('settings');
    store().open('admin');
    saveSession('u_1');
    useWindows.setState({ wins: [], zTop: 1 });
    expect(restoreSession('u_1', (id) => id !== 'admin')).toBe(1);
    expect(store().wins.map((w) => w.id)).toEqual(['settings']);
    expect(restoreSession('u_1', all)).toBe(0);
  });

  it('survives junk in storage', () => {
    window.localStorage.setItem('ui:session:v1', '{not json');
    expect(restoreSession('u_1', all)).toBe(0);
    window.localStorage.setItem('ui:session:v1', JSON.stringify({ user: 'u_1', wins: [{ id: 5 }, null, { id: 'settings', path: 'x'.repeat(500), minimized: false, maximized: false }] }));
    expect(restoreSession('u_1', all)).toBe(0);
  });
});

describe('resizing from any edge', () => {
  const g = { x: 100, y: 100, w: 600, h: 400 };
  it('moves the opposite edge nowhere', () => {
    expect(resizeFrom('e', g, 50, 0)).toEqual({ x: 100, y: 100, w: 650, h: 400 });
    expect(resizeFrom('w', g, 50, 0)).toEqual({ x: 150, y: 100, w: 550, h: 400 });
    expect(resizeFrom('n', g, 0, -30)).toEqual({ x: 100, y: 70, w: 600, h: 430 });
    expect(resizeFrom('nw', g, -20, -20)).toEqual({ x: 80, y: 80, w: 620, h: 420 });
    expect(resizeFrom('se', g, 10, 10)).toEqual({ x: 100, y: 100, w: 610, h: 410 });
  });
  it('stops at the minimum size without sliding the window', () => {
    const r = resizeFrom('w', g, 500, 0);
    expect(r.w).toBe(MIN_W);
    expect(r.x + r.w).toBe(g.x + g.w); // the right edge did not move
    const t = resizeFrom('n', g, 0, 500);
    expect(t.h).toBe(MIN_H);
    expect(t.y + t.h).toBe(g.y + g.h);
  });
});

describe('snapping by dragging to an edge', () => {
  it('knows the zones', () => {
    expect(snapZone({ x: 0, y: 300 }, V)).toBe('left');
    expect(snapZone({ x: V.w - 1, y: 300 }, V)).toBe('right');
    expect(snapZone({ x: 400, y: 10 }, V)).toBe('max');
    expect(snapZone({ x: 400, y: 300 }, V)).toBeNull();
  });

  it('takes a quarter in each corner, and fills half or all of the desktop in the right place', () => {
    expect(snapZone({ x: 0, y: TASKBAR_HEIGHT + 10 }, V)).toBe('top-left');
    expect(snapZone({ x: V.w - 1, y: V.h - 5 }, V)).toBe('bottom-right');
    expect(snapZone({ x: 20, y: 5 }, V)).toBe('top-left'); // dragged into the very corner past the taskbar
    const a = { w: V.w, h: V.h - TASKBAR_HEIGHT };
    expect(snapGeometry('bottom-right', V)).toEqual({ x: a.w - a.w / 2, y: a.h - a.h / 2, w: a.w / 2, h: a.h / 2 });
    expect(snapGeometry('left', V)).toEqual({ x: 0, y: 0, w: a.w / 2, h: a.h });
    store().snap('settings', 'top-right');
  });
});

describe("a window's own history", () => {
  it('goes back and forward, and a new place drops the forward part', () => {
    store().open('settings');
    store().setPath('settings', 'a');
    store().setPath('settings', 'b');
    store().back('settings');
    expect(win('settings').path).toBe('a');
    store().forward('settings');
    expect(win('settings').path).toBe('b');
    store().back('settings');
    store().setPath('settings', 'c');
    expect(win('settings').history).toEqual(['', 'a', 'c']);
    store().forward('settings'); // nothing ahead
    expect(win('settings').path).toBe('c');
  });
  it('replacing the place does not add to the history, and staying put adds nothing', () => {
    store().open('settings', 'x');
    store().setPath('settings', 'y', true);
    store().setPath('settings', 'y');
    expect(win('settings').history).toEqual(['y']);
  });
  it('opening an app at a place from elsewhere adds that place', () => {
    store().open('settings');
    store().open('settings', 'appearance');
    expect(win('settings').history).toEqual(['', 'appearance']);
  });
});
