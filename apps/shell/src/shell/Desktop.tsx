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
import { DIRS, folderKey, foldered, gridSize, moveTo, neighbour, place, shortcutKey, type Dir, type Pos } from './desktopLayout.logic';
import { useShortcutView } from './ShortcutIcon';
import { DESKTOP_MAX_COL, DESKTOP_MAX_ROW, type DesktopShortcut } from '@app/shared';
import { dropLink, linkFromDrop } from './dropLink';
import { FolderPanel, FolderTile, folderMenu, folderOwnMenu } from './Folders';
import type { DesktopFolder } from '@app/shared';

// A drag that carries a link (the address is only readable on drop).
const canTakeLink = (dt: DataTransfer) => ['text/uri-list', 'text/x-moz-url', 'text/plain'].some((x) => dt.types.includes(x));

// The icon grid: fixed cells, so a drop can be turned into a column and a row (and the CSS and the maths agree).
const CELL_W = 96; const CELL_H = 104; const GAP = 8;

// The desktop for big screens: an icon per app and the home panel, with the open windows on top.
export function Desktop({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  const { wins, setViewport, snapPreview, viewport } = useWindows();
  const top = focusedWindow(wins);
  const [dropping, setDropping] = useState(false);
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
  const inFolders = useMemo(() => foldered(settings), [settings]);
  const gridApps = apps.filter((a) => !inFolders.has(a.id));
  const gridShortcuts = settings.shortcuts.filter((x) => !inFolders.has(shortcutKey(x.id)));
  const keys = useMemo(() => [...gridApps.map((a) => a.id as string), ...gridShortcuts.map((x) => shortcutKey(x.id)), ...settings.folders.map((f) => folderKey(f.id))], [gridApps, gridShortcuts, settings.folders]);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
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
      <div className={`desktop-layout${dropping ? ' is-drop' : ''}`} tabIndex={-1} data-drop-hint={t('desktop.drop.hint')}
        onDragOver={(e) => { if (canTakeLink(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropping(true); } }}
        onDragLeave={(e) => { if (e.target === e.currentTarget) setDropping(false); }}
        onDrop={(e) => {
          setDropping(false);
          const link = linkFromDrop(e.dataTransfer);
          if (!link) return;
          e.preventDefault();
          // The cell under the pointer, if it is on the icon grid; the new shortcut goes there.
          const box = grid.current?.getBoundingClientRect();
          const cell = box ? { col: Math.floor((e.clientX - box.left) / (CELL_W + GAP)), row: Math.floor((e.clientY - box.top) / (CELL_H + GAP)) } : null;
          void dropLink(link, me).then((id) => {
            if (!id || !cell || cell.col < 0 || cell.row < 0 || cell.col > DESKTOP_MAX_COL || cell.row > DESKTOP_MAX_ROW) return;
            useDesktopLayout.getState().update((st) => ({ ...st, positions: { ...st.positions, [shortcutKey(id)]: cell } }));
          });
        }}
        onContextMenu={(e) => { if (e.target === e.currentTarget) ctx.bind.onContextMenu(e); }}
        onKeyDown={(e) => { if (e.target === e.currentTarget) ctx.bind.onKeyDown(e); }}>
        <ul className="icons" aria-label={t('nav.apps')} ref={grid}
          style={{ gridTemplateColumns: `repeat(${size.cols}, ${CELL_W}px)`, gridTemplateRows: `repeat(${size.rows}, ${CELL_H}px)`, gap: GAP }}>
          {gridApps.map((app) => {
            const pos = layout.get(app.id)!;
            return (
              <li key={app.id} style={{ gridColumn: pos.col + 1, gridRow: pos.row + 1 }}>
                <DesktopIcon app={app} pos={pos} grid={grid} onMoveTo={(to) => moveIcon(app.id, appName(app, t), to)} onDragging={setDragging} />
              </li>
            );
          })}
          {gridShortcuts.map((sc) => {
            const pos = layout.get(shortcutKey(sc.id))!;
            return (
              <li key={sc.id} style={{ gridColumn: pos.col + 1, gridRow: pos.row + 1 }}>
                <ShortcutDesktopIcon sc={sc} pos={pos} grid={grid} available={available} onMoveTo={(to) => moveIcon(shortcutKey(sc.id), sc.label, to)} onDragging={setDragging} />
              </li>
            );
          })}
          {settings.folders.map((f) => {
            const pos = layout.get(folderKey(f.id))!;
            return (
              <li key={f.id} style={{ gridColumn: pos.col + 1, gridRow: pos.row + 1 }}>
                <FolderDesktopIcon folder={f} pos={pos} grid={grid} onOpen={() => setOpenFolder(f.id)} onMoveTo={(to) => moveIcon(folderKey(f.id), f.name, to)} onDragging={setDragging} />
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
      {openFolder && settings.folders.some((f) => f.id === openFolder) && (
        <FolderPanel folder={settings.folders.find((f) => f.id === openFolder)!} apps={apps} available={available} onClose={() => setOpenFolder(null)}
          opener={{ app: (a) => useWindows.getState().open(a.id), shortcut: (sc) => openShortcut(sc) }} />
      )}
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
    ...folderMenu(app.id, t),
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
  const go = () => { if (!view.missing) openShortcut(sc, view.url); };
  const ctx = useContextMenu(() => [
    { label: t('desktop.shortcut.open', { label: sc.label }), onSelect: go, disabled: view.missing },
    ...moveItems(pos, step, t),
    ...folderMenu(shortcutKey(sc.id), t),
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

// Opens what a shortcut points at: a bookmark in a new tab, a place in its app's window.
function openShortcut(sc: DesktopShortcut, url?: string) {
  if (sc.target.type === 'bookmark') {
    if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    void import('../api').then(({ api }) => api.get<{ url: string }>(`/bookmarks/${(sc.target as { bookmark_id: string }).bookmark_id}`))
      .then((b) => window.open(b.url, '_blank', 'noopener,noreferrer')).catch(() => undefined);
    return;
  }
  useWindows.getState().open(sc.target.app as AppId, sc.target.path || undefined);
}

// A folder on the desktop: opens on a click, can be dragged and moved like an icon, renamed or deleted from its menu.
function FolderDesktopIcon({ folder, pos, grid, onOpen, onMoveTo, onDragging }: { folder: DesktopFolder; pos: Pos; grid: React.RefObject<HTMLUListElement | null>; onOpen: () => void; onMoveTo: (to: Pos) => void; onDragging: (on: boolean) => void }) {
  const t = useT();
  const drag = useIconDrag(pos, grid, onMoveTo, onDragging);
  const step = (dir: Dir) => { const n = neighbour(pos, dir); if (n) onMoveTo(n); };
  const ctx = useContextMenu(() => [...folderOwnMenu(folder, t, onOpen), ...moveItems(pos, step, t)]);
  return (
    <>
      <button type="button" className={`icon is-folder${drag.offset ? ' is-dragging' : ''}`} data-folder={folder.id} aria-haspopup="dialog"
        aria-label={t('desktop.folder.label', { name: folder.name, count: folder.items.length })} {...ctx.bind} {...drag.bind}
        onClick={() => { if (drag.consumeClick()) return; onOpen(); }}
        onKeyDown={(e) => { if (drag.escape(e)) return; ctx.bind.onKeyDown?.(e); }}>
        <FolderTile count={folder.items.length} />
        <span className="icon-label">{folder.name}</span>
      </button>
      {ctx.menu}
    </>
  );
}
