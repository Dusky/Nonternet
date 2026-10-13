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
import { focusedWindow, restoreSession, saveSession, snapGeometry, useWindows } from './windows';
import { Window } from './Window';
import { useContextMenu } from '../components/Menu';
import type { AppDef } from './apps';
import { MODES, saveModePref, modePref } from '../theme';
import { toast } from '../components/feedback';
import { shownApps, useDesktopLayout } from './desktopLayout';
import { DIRS, gridSize, moveTo, neighbour, place, type Dir, type Pos } from './desktopLayout.logic';

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
    { label: t('desktop.ctx.reset'), onSelect: () => { const before = useDesktopLayout.getState().reset(); toast(t('desktop.resetDone'), 'ok', { undo: () => useDesktopLayout.getState().restore(before) }); }, disabled: !layoutReady || (Object.keys(layoutState.positions).length === 0 && layoutState.hidden.length === 0) },
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
  const layout = useMemo(() => place(apps.map((a) => a.id), settings.positions), [apps, settings.positions]);
  const [dragging, setDragging] = useState(false);
  const [said, setSaid] = useState('');
  const grid = useRef<HTMLUListElement>(null);
  const size = gridSize(layout, dragging);
  const moveIcon = (app: AppDef, to: Pos) => {
    useDesktopLayout.getState().update((st) => ({ ...st, positions: moveTo(layout, app.id, to) }));
    setSaid(t('desktop.moved', { app: appName(app, t), row: to.row + 1, col: to.col + 1 }));
  };
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
                <DesktopIcon app={app} pos={pos} grid={grid} onMoveTo={(to) => moveIcon(app, to)} onDragging={setDragging} />
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

// An app on the desktop. Drag it to another cell, or use its menu (right-click, or Shift+F10): open it here or on a page of its
// own, move it a cell at a time, hide it. A drag is a pointer moving past a few pixels; a plain click still opens the app.
function DesktopIcon({ app, pos, grid, onMoveTo, onDragging }: { app: AppDef; pos: Pos; grid: React.RefObject<HTMLUListElement | null>; onMoveTo: (to: Pos) => void; onDragging: (on: boolean) => void }) {
  const t = useT();
  const open = useWindows((s) => s.open);
  const title = appName(app, t);
  const qc = useQueryClient();
  const badge = useAppBadge(app.id);
  const named = useAppLabel(app.id, title);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const step = (dir: Dir) => { const n = neighbour(pos, dir); if (n) onMoveTo(n); };
  const ctx = useContextMenu(() => [
    { label: t('app.openApp', { app: title }), onSelect: () => open(app.id) },
    { label: t('ctx.openPage'), onSelect: () => window.open(app.path, '_blank', 'noopener') },
    ...(badge && READ_KINDS[app.id] ? [{ label: t('ctx.markRead'), onSelect: () => void markAppRead(qc, app.id) }] : []),
    ...DIRS.map((d, i) => ({ label: t(`desktop.icon.move.${d}`), onSelect: () => step(d), disabled: neighbour(pos, d) === null, separator: i === 0 })),
    ...(app.id === 'settings' ? [] : [{ label: t('desktop.icon.hide'), onSelect: () => { useDesktopLayout.getState().hide(app.id); toast(t('desktop.hidden', { app: title })); } }]),
  ]);
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = start.current;
    if (!d) return;
    const dx = e.clientX - d.x; const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; onDragging(true); }
    if (d.moved) setOffset({ x: dx, y: dy });
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
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
  };
  const cancel = () => { start.current = null; setOffset(null); onDragging(false); };
  return (
    <>
      <button type="button" className={`icon${offset ? ' is-dragging' : ''}`} data-app-icon={app.id} aria-label={t('app.openApp', { app: named })} {...ctx.bind}
        style={offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
        onClick={() => { if (justDragged.current) { justDragged.current = false; return; } open(app.id); }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
        onKeyDown={(e) => { if (e.key === 'Escape' && offset) { e.stopPropagation(); cancel(); return; } ctx.bind.onKeyDown?.(e); }}>
        <AppTile id={app.id} /><AppBadge id={app.id} />
        <span className="icon-label">{title}</span>
      </button>
      {ctx.menu}
    </>
  );
}
