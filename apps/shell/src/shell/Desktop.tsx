import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Me } from '@app/shared';
import { useSite, useT } from '../hooks';
import { appById, appName, useVisibleApps, visibleApps } from './apps';
import { useInstalled } from './installed';
import { HomePanel } from './HomePanel';
import { useQueryClient } from '@tanstack/react-query';
import { AppBadge, useAppLabel } from '../components/AppBadge';
import { markAppRead, READ_KINDS, useAppBadge } from './appBadges';
import { AppTile } from './icons';
import { focusedWindow, restoreSession, saveSession, snapGeometry, useWindows, type AppId } from './windows';
import { Window } from './Window';
import { useContextMenu } from '../components/Menu';
import type { AppDef } from './apps';
import { MODES, saveModePref, modePref } from '../theme';
import { toast } from '../components/feedback';
import { shownApps, useDesktopLayout } from './desktopLayout';
import { DIRS, gridSize, moveTo, neighbour, place, shortcutKey, type Dir, type Pos } from './desktopLayout.logic';
import { useShortcutView } from './ShortcutIcon';
import type { DesktopShortcut } from '@app/shared';

// The icon grid: fixed cells, so a drop can be turned into a column and a row (and the CSS and the maths agree).
const CELL_W = 96; const CELL_H = 104; const GAP = 8;

// The desktop for big screens: an icon per app and the home panel, with the open windows on top.
export function Desktop({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  const { wins, setViewport, snapPreview, viewport } = useWindows();
  const top = focusedWindow(wins);
  const open = useWindows((s) => s.open);
  // Right-click (or Shift+F10) on the bare desktop: the things people reach for most.
  const layoutState = useDesktopLayout((st) => st.settings);
  const layoutReady = useDesktopLayout((st) => st.loaded);
  const hiddenApps = useVisibleApps(me, site).filter((a) => layoutState.hidden.includes(a.id));
  const ctx = useContextMenu(() => [
    { label: t('desktop.ctx.wallpaper'), onSelect: () => open('settings', 'appearance') },
    ...MODES.map((m) => ({ label: `${t(`desktop.ctx.mode.${m}`)}${modePref() === m ? ` ${t('desktop.ctx.current')}` : ''}`, onSelect: () => saveModePref(m) })),
    { label: t('desktop.ctx.arrange'), onSelect: () => useDesktopLayout.getState().update((st) => ({ ...st, positions: {} })), disabled: !layoutReady || Object.keys(layoutState.positions).length === 0, separator: true },
    ...hiddenApps.map((a) => ({ label: t('desktop.ctx.showHidden', { app: appName(a, t) }), onSelect: () => useDesktopLayout.getState().show(a.id) })),
    { label: t('desktop.ctx.homeEdit'), onSelect: () => useDesktopLayout.getState().setEditingHome(true), disabled: !layoutReady },
    { label: t('desktop.ctx.reset'), onSelect: () => { const before = useDesktopLayout.getState().reset(); toast(t('desktop.resetDone'), 'ok', { undo: () => useDesktopLayout.getState().restore(before) }); }, disabled: !layoutReady || (Object.keys(layoutState.positions).length === 0 && layoutState.hidden.length === 0 && !layoutState.widgets_set) },
    { label: t('desktop.ctx.showDesktop'), onSelect: () => useWindows.getState().toggleShowDesktop(), disabled: wins.length === 0, separator: true },
    { label: t('desktop.ctx.closeAll'), onSelect: () => useWindows.getState().closeAll(), disabled: wins.length === 0, danger: true },
    { label: t('app.settings'), onSelect: () => open('settings'), separator: true },
  ]);

  useEffect(() => {
    const fit = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [setViewport]);

  // Reopen what was open last time, and keep remembering as windows come and go. Waits for the list of added
  // apps, so their windows come back too.
  const installedLoaded = useInstalled((s) => s.loaded);
  const allApps = useVisibleApps(me, site);
  useEffect(() => { void useDesktopLayout.getState().load(); }, []);
  const settings = useDesktopLayout((st) => st.settings);
  const apps = shownApps(allApps, settings, false);
  const keys = useMemo(() => [...apps.map((a) => a.id as string), ...settings.shortcuts.map((x) => shortcutKey(x.id))], [apps, settings.shortcuts]);
  const layout = useMemo(() => place(keys, settings.positions), [keys, settings.positions]);
  const [dragging, setDragging] = useState(false);
  const [said, setSaid] = useState('');
  const grid = useRef<HTMLUListElement>(null);
  const size = gridSize(layout, dragging);
  const moveIcon = (key: string, name: string, to: Pos) => {
    useDesktopLayout.getState().update((st) => ({ ...st, positions: moveTo(layout, key, to) }));
    setSaid(t('desktop.moved', { app: name, row: to.row + 1, col: to.col + 1 }));
  };
  const available = useMemo(() => new Set<string>(allApps.map((a) => a.id)), [allApps]);
  useEffect(() => {
    if (!installedLoaded) return;
    const allowed = new Set(visibleApps(me, site).map((a) => a.id));
    restoreSession(me.id, (id) => allowed.has(id) && Boolean(appById(id)));
    return useWindows.subscribe(() => saveSession(me.id));
  }, [me, site, installedLoaded]);

  return (
    <div className="desktop" aria-label={t('nav.desktop')}>
      <div className="desktop-layout" tabIndex={-1}
        onContextMenu={(e) => { if (e.target === e.currentTarget) ctx.bind.onContextMenu(e); }}
        onKeyDown={(e) => { if (e.target === e.currentTarget) ctx.bind.onKeyDown(e); }}>
        <ul className="icons" aria-label={t('nav.apps')} ref={grid}
          style={{ gridTemplateColumns: `repeat(${size.cols}, ${CELL_W}px)`, gridTemplateRows: `repeat(${size.rows}, ${CELL_H}px)`, gap: GAP }}>
          {apps.map((app) => {
            const pos = layout.get(app.id)!;
            return (
              <li key={app.id} style={{ gridColumn: pos.col + 1, gridRow: pos.row + 1 }}>
                <DesktopIcon app={app} pos={pos} grid={grid} onMoveTo={(to) => moveIcon(app.id, appName(app, t), to)} onDragging={setDragging} />
              </li>
            );
          })}
          {settings.shortcuts.map((sc) => {
            const pos = layout.get(shortcutKey(sc.id))!;
            return (
              <li key={sc.id} style={{ gridColumn: pos.col + 1, gridRow: pos.row + 1 }}>
                <ShortcutDesktopIcon sc={sc} pos={pos} grid={grid} available={available} onMoveTo={(to) => moveIcon(shortcutKey(sc.id), sc.label, to)} onDragging={setDragging} />
              </li>
            );
          })}
        </ul>
        <p className="visually-hidden" role="status">{said}</p>
        <HomePanel me={me} />
      </div>
      {snapPreview && <div className="snap-preview" aria-hidden="true" style={{ left: snapGeometry(snapPreview, viewport).x, top: snapGeometry(snapPreview, viewport).y, width: snapGeometry(snapPreview, viewport).w, height: snapGeometry(snapPreview, viewport).h }} />}
      {wins.map((w) => <Window key={w.id} win={w} focused={top?.id === w.id} />)}
      {ctx.menu}
    </div>
  );
}

// Dragging an icon to another cell: a pointer moving past a few pixels. A plain click still opens it, and Escape cancels.
function useIconDrag(pos: Pos, grid: React.RefObject<HTMLUListElement | null>, onMoveTo: (to: Pos) => void, onDragging: (on: boolean) => void) {
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const cancel = () => { start.current = null; setOffset(null); onDragging(false); };
  return {
    offset,
    // True when this click ends a drag and must not open anything.
    consumeClick: () => { if (justDragged.current) { justDragged.current = false; return true; } return false; },
    // Escape during a drag cancels it; true when it did.
    escape: (e: { key: string; stopPropagation: () => void }) => { if (e.key === 'Escape' && offset) { e.stopPropagation(); cancel(); return true; } return false; },
    bind: {
      style: offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined,
      onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
        const d = start.current;
        if (!d) return;
        const dx = e.clientX - d.x; const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; onDragging(true); }
        if (d.moved) setOffset({ x: dx, y: dy });
      },
      onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
        const d = start.current;
        start.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (!d?.moved) return;
        justDragged.current = true;
        setOffset(null); onDragging(false);
        const box = grid.current?.getBoundingClientRect();
        if (!box) return;
        const col = Math.floor((e.clientX - box.left) / (CELL_W + GAP));
        const row = Math.floor((e.clientY - box.top) / (CELL_H + GAP));
        if (col >= 0 && row >= 0 && (col !== pos.col || row !== pos.row)) onMoveTo({ col, row });
      },
      onPointerCancel: cancel,
    },
  };
}

// Move left, right, up, down: the same on every icon's menu, so the keyboard never needs a drag.
const moveItems = (pos: Pos, step: (d: Dir) => void, t: ReturnType<typeof useT>) =>
  DIRS.map((d, i) => ({ label: t(`desktop.icon.move.${d}`), onSelect: () => step(d), disabled: neighbour(pos, d) === null, separator: i === 0 }));

// An app on the desktop. Drag it to another cell, or use its menu (right-click, or Shift+F10): open it here or on a page of its
// own, move it a cell at a time, hide it.
function DesktopIcon({ app, pos, grid, onMoveTo, onDragging }: { app: AppDef; pos: Pos; grid: React.RefObject<HTMLUListElement | null>; onMoveTo: (to: Pos) => void; onDragging: (on: boolean) => void }) {
  const t = useT();
  const open = useWindows((s) => s.open);
  const title = appName(app, t);
  const qc = useQueryClient();
  const badge = useAppBadge(app.id);
  const named = useAppLabel(app.id, title);
  const drag = useIconDrag(pos, grid, onMoveTo, onDragging);
  const step = (dir: Dir) => { const n = neighbour(pos, dir); if (n) onMoveTo(n); };
  const ctx = useContextMenu(() => [
    { label: t('app.openApp', { app: title }), onSelect: () => open(app.id) },
    { label: t('ctx.openPage'), onSelect: () => window.open(app.path, '_blank', 'noopener') },
    ...(badge && READ_KINDS[app.id] ? [{ label: t('ctx.markRead'), onSelect: () => void markAppRead(qc, app.id) }] : []),
    ...moveItems(pos, step, t),
    ...(app.id === 'settings' ? [] : [{ label: t('desktop.icon.hide'), onSelect: () => { useDesktopLayout.getState().hide(app.id); toast(t('desktop.hidden', { app: title })); } }]),
  ]);
  return (
    <>
      <button type="button" className={`icon${drag.offset ? ' is-dragging' : ''}`} data-app-icon={app.id} aria-label={t('app.openApp', { app: named })} {...ctx.bind} {...drag.bind}
        onClick={() => { if (drag.consumeClick()) return; open(app.id); }}
        onKeyDown={(e) => { if (drag.escape(e)) return; ctx.bind.onKeyDown?.(e); }}>
        <AppTile id={app.id} /><AppBadge id={app.id} />
        <span className="icon-label">{title}</span>
      </button>
      {ctx.menu}
    </>
  );
}

// A shortcut on the desktop: it opens a bookmark (in a new tab) or a place inside an app. Missing targets stay on the desktop,
// marked, so the person can remove them.
function ShortcutDesktopIcon({ sc, pos, grid, available, onMoveTo, onDragging }: { sc: DesktopShortcut; pos: Pos; grid: React.RefObject<HTMLUListElement | null>; available: Set<string>; onMoveTo: (to: Pos) => void; onDragging: (on: boolean) => void }) {
  const t = useT();
  const open = useWindows((s) => s.open);
  const view = useShortcutView(sc, available);
  const drag = useIconDrag(pos, grid, onMoveTo, onDragging);
  const step = (dir: Dir) => { const n = neighbour(pos, dir); if (n) onMoveTo(n); };
  const go = () => {
    if (view.missing) return;
    if (sc.target.type === 'bookmark') { if (view.url) window.open(view.url, '_blank', 'noopener,noreferrer'); return; }
    open(sc.target.app as AppId, sc.target.path || undefined);
  };
  const ctx = useContextMenu(() => [
    { label: t('desktop.shortcut.open', { label: sc.label }), onSelect: go, disabled: view.missing },
    ...moveItems(pos, step, t),
    { label: t('desktop.shortcut.rename'), onSelect: () => { const name = window.prompt(t('desktop.shortcut.renamePrompt'), sc.label); if (name) useDesktopLayout.getState().renameShortcut(sc.id, name); }, separator: true },
    { label: t('desktop.shortcut.remove'), onSelect: () => { useDesktopLayout.getState().removeShortcut(sc.id); toast(t('desktop.shortcut.removed')); } },
  ]);
  return (
    <>
      <button type="button" className={`icon is-shortcut${drag.offset ? ' is-dragging' : ''}${view.missing ? ' is-missing' : ''}`} data-shortcut={sc.id}
        aria-label={view.missing ? t('desktop.shortcut.missing', { label: sc.label }) : t('desktop.shortcut.open', { label: sc.label })}
        title={view.missing ? t('desktop.shortcut.missingNote') : sc.target.type === 'bookmark' ? t('desktop.shortcut.newTab') : undefined}
        {...ctx.bind} {...drag.bind}
        onClick={() => { if (drag.consumeClick()) return; go(); }}
        onKeyDown={(e) => { if (drag.escape(e)) return; ctx.bind.onKeyDown?.(e); }}>
        {view.tile}
        <span className="icon-label">{sc.label}</span>
      </button>
      {ctx.menu}
    </>
  );
}
