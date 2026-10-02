import { Suspense, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { AppBoundary } from '../components/Boundary';
import { useContextMenu, type MenuItem } from '../components/ContextMenu';
import { Icon } from '../components/Icon';
import { Loading } from '../components/ui';
import { useT } from '../hooks';
import { WindowNav } from '../nav';
import { appById } from './apps';
import { AppIcon } from './icons';
import { resizeFrom, snapZone, useWindows, type Edge, type Win } from './windows';

const STEP = 16;
const EDGES: Edge[] = ['e', 's', 'w', 'n', 'se', 'sw', 'ne', 'nw']; // corners last, so they sit on top of the sides

// One window on the desktop. Drag the title bar to move it (to the left or right edge of the screen to take
// half of it, to the top to fill it); drag any edge or corner to resize. From the keyboard, in the title bar:
// arrows move, Shift+arrows resize, Alt+Left and Alt+Right snap. In the window, Alt+Left and Alt+Right go back
// and forward. Opening a window moves focus into it; closing it gives focus to the window behind.
export function Window({ win, focused }: { win: Win; focused: boolean }) {
  const t = useT();
  const { focus, close, minimize, toggleMaximize, snap, move, resize, back, forward, setSnapPreview, viewport } = useWindows();
  const sub = useWindows((s) => s.subtitles[win.id]);
  const titleBar = useRef<HTMLElement>(null);
  useEffect(() => { titleBar.current?.focus({ preventScroll: true }); }, []);
  const app = appById(win.id);
  const title = t(app.title);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const sizing = useRef<{ edge: Edge; startX: number; startY: number; start: { x: number; y: number; w: number; h: number } } | null>(null);

  const items = (): MenuItem[] => [
    { label: win.minimized ? t('window.focus', { app: title }) : t('window.minimize', { app: title }), onSelect: () => minimize(win.id) },
    { label: win.maximized ? t('window.restore', { app: title }) : t('window.maximize', { app: title }), onSelect: () => toggleMaximize(win.id) },
    { label: t('window.snapLeft'), onSelect: () => snap(win.id, 'left') },
    { label: t('window.snapRight'), onSelect: () => snap(win.id, 'right') },
    { label: t('window.snapTopLeft'), onSelect: () => snap(win.id, 'top-left') },
    { label: t('window.snapTopRight'), onSelect: () => snap(win.id, 'top-right') },
    { label: t('window.snapBottomLeft'), onSelect: () => snap(win.id, 'bottom-left') },
    { label: t('window.snapBottomRight'), onSelect: () => snap(win.id, 'bottom-right') },
    { label: t('window.close', { app: title }), onSelect: () => { close(win.id); focusFront(win.id); }, danger: true },
  ];
  const ctx = useContextMenu(items);

  const onTitleDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0) return; // the buttons are not a drag handle
    focus(win.id);
    if (win.maximized) return;
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTitleMove = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    move(win.id, e.clientX - drag.current.dx, e.clientY - drag.current.dy);
    setSnapPreview(snapZone({ x: e.clientX, y: e.clientY }, viewport));
  };
  const onTitleUp = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    const zone = snapZone({ x: e.clientX, y: e.clientY }, viewport);
    setSnapPreview(null);
    if (zone === 'max') toggleMaximize(win.id);
    else if (zone) snap(win.id, zone);
  };

  const onEdgeDown = (edge: Edge) => (e: ReactPointerEvent) => {
    if (win.maximized) return;
    e.stopPropagation();
    focus(win.id);
    sizing.current = { edge, startX: e.clientX, startY: e.clientY, start: { x: win.x, y: win.y, w: win.w, h: win.h } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onEdgeMove = (e: ReactPointerEvent) => {
    const s = sizing.current;
    if (s) resize(win.id, resizeFrom(s.edge, s.start, e.clientX - s.startX, e.clientY - s.startY));
  };
  const onEdgeUp = () => { sizing.current = null; };

  const onKey = (e: KeyboardEvent) => {
    ctx.bind.onKeyDown(e);
    if (e.defaultPrevented) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); snap(win.id, e.key === 'ArrowLeft' ? 'left' : 'right'); return; }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); if (!win.maximized) toggleMaximize(win.id); return; }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); if (win.maximized) toggleMaximize(win.id); return; }
    const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
    if (!d || win.maximized) return;
    e.preventDefault();
    // Shift: the right or bottom edge moves. Ctrl+Shift: the left or top edge moves.
    if (e.shiftKey && (e.ctrlKey || e.metaKey)) resize(win.id, resizeFrom(d[0] ? 'w' : 'n', { x: win.x, y: win.y, w: win.w, h: win.h }, d[0]!, d[1]!));
    else if (e.shiftKey) resize(win.id, { x: win.x, y: win.y, w: win.w + d[0]!, h: win.h + d[1]! });
    else move(win.id, win.x + d[0]!, win.y + d[1]!);
  };
  // In the window itself the same keys mean Back and Forward, as in a browser.
  const onBodyKey = (e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); back(win.id); } else if (e.key === 'ArrowRight') { e.preventDefault(); forward(win.id); }
  };

  return (
    <section
      className={`window${focused ? ' is-focused' : ''}${win.maximized ? ' is-maximized' : ''}`}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z, display: win.minimized ? 'none' : undefined }}
      role="dialog"
      aria-label={t('window.label', { app: title })}
      onPointerDownCapture={() => { if (!focused) focus(win.id); }}
    >
      <header
        ref={titleBar} className="window-title" tabIndex={0} onPointerDown={onTitleDown} onPointerMove={onTitleMove} onPointerUp={onTitleUp}
        onDoubleClick={() => toggleMaximize(win.id)} onKeyDown={onKey} onContextMenu={ctx.bind.onContextMenu}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Control+Shift+ArrowLeft Control+Shift+ArrowUp Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Shift+F10"
      >
        <div className="window-buttons">
          <button type="button" className="is-nav" aria-label={t('window.back', { app: title })} disabled={win.cursor === 0} onClick={() => back(win.id)}><Icon name="back" /></button>
          <button type="button" className="is-nav" aria-label={t('window.forward', { app: title })} disabled={win.cursor >= win.history.length - 1} onClick={() => forward(win.id)}><Icon name="arrow" /></button>
        </div>
        <h2><AppIcon id={win.id} size={18} />{title}{sub && <span className="window-sub">{sub}</span>}</h2>
        <div className="window-buttons">
          <button type="button" aria-label={t('window.minimize', { app: title })} onClick={() => { minimize(win.id); focusFront(); }}><Icon name="minimize" /></button>
          <button type="button" aria-label={win.maximized ? t('window.restore', { app: title }) : t('window.maximize', { app: title })} onClick={() => toggleMaximize(win.id)}><Icon name={win.maximized ? 'restore' : 'maximize'} /></button>
          <button type="button" className="is-close" aria-label={t('window.close', { app: title })} onClick={() => { close(win.id); focusFront(win.id); }}><Icon name="close" /></button>
        </div>
      </header>
      {ctx.menu}
      <div className="window-body" onKeyDown={onBodyKey}>
        <WindowNav id={win.id} base={app.path}>
          <AppBoundary><Suspense fallback={<Loading />}><app.Component /></Suspense></AppBoundary>
        </WindowNav>
      </div>
      {!win.maximized && EDGES.map((edge) => (
        <div key={edge} className={`edge edge-${edge}`} onPointerDown={onEdgeDown(edge)} onPointerMove={onEdgeMove} onPointerUp={onEdgeUp} />
      ))}
    </section>
  );
}

// After a window goes away, keyboard focus goes to the window now in front, or to the desktop icon of
// the app that was closed, so it never falls to the top of the page.
function focusFront(closed?: string) {
  setTimeout(() => {
    const front = document.querySelector<HTMLElement>('.window.is-focused .window-title');
    const icon = closed ? document.querySelector<HTMLElement>(`[data-app-icon="${closed}"]`) : null;
    (front ?? icon ?? document.getElementById('main'))?.focus({ preventScroll: true });
  }, 0);
}
