import { Suspense, useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { Loading } from '../components/ui';
import { useT } from '../hooks';
import { WindowNav } from '../nav';
import { appById } from './apps';
import { AppIcon } from './icons';
import { useWindows, type Win } from './windows';

const STEP = 16;

// One window on the desktop. It can be dragged by its title bar, resized from the right, bottom and
// corner, and moved or resized from the keyboard (arrow keys, with Shift to resize; Alt+Left and
// Alt+Right snap it to half the screen). Opening a window moves focus into it; closing it gives focus
// to the window behind, or back to the desktop.
export function Window({ win, focused }: { win: Win; focused: boolean }) {
  const t = useT();
  const { focus, close, minimize, toggleMaximize, snap, move, resize } = useWindows();
  const titleBar = useRef<HTMLElement>(null);
  useEffect(() => { titleBar.current?.focus({ preventScroll: true }); }, []);
  const app = appById(win.id);
  const title = t(app.title);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const sizing = useRef<{ edge: 'e' | 's' | 'se'; startX: number; startY: number; w: number; h: number } | null>(null);

  const onTitleDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // the buttons are not a drag handle
    focus(win.id);
    if (win.maximized) return;
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onTitleMove = (e: ReactPointerEvent) => { if (drag.current) move(win.id, e.clientX - drag.current.dx, e.clientY - drag.current.dy); };
  const onTitleUp = () => { drag.current = null; };

  const onEdgeDown = (edge: 'e' | 's' | 'se') => (e: ReactPointerEvent) => {
    if (win.maximized) return;
    e.stopPropagation();
    focus(win.id);
    sizing.current = { edge, startX: e.clientX, startY: e.clientY, w: win.w, h: win.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onEdgeMove = (e: ReactPointerEvent) => {
    const s = sizing.current;
    if (!s) return;
    resize(win.id, { x: win.x, y: win.y, w: s.edge === 's' ? win.w : s.w + e.clientX - s.startX, h: s.edge === 'e' ? win.h : s.h + e.clientY - s.startY });
  };
  const onEdgeUp = () => { sizing.current = null; };

  const onKey = (e: KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); snap(win.id, e.key === 'ArrowLeft' ? 'left' : 'right'); return; }
    const d = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] }[e.key];
    if (!d || win.maximized) return;
    e.preventDefault();
    if (e.shiftKey) resize(win.id, { x: win.x, y: win.y, w: win.w + d[0]!, h: win.h + d[1]! });
    else move(win.id, win.x + d[0]!, win.y + d[1]!);
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
        onDoubleClick={() => toggleMaximize(win.id)} onKeyDown={onKey} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
      >
        <h2><AppIcon id={win.id} size={18} />{title}</h2>
        <div className="window-buttons">
          <button type="button" aria-label={t('window.minimize', { app: title })} onClick={() => { minimize(win.id); focusFront(); }}><Icon name="minimize" /></button>
          <button type="button" aria-label={win.maximized ? t('window.restore', { app: title }) : t('window.maximize', { app: title })} onClick={() => toggleMaximize(win.id)}><Icon name={win.maximized ? 'restore' : 'maximize'} /></button>
          <button type="button" className="is-close" aria-label={t('window.close', { app: title })} onClick={() => { close(win.id); focusFront(win.id); }}><Icon name="close" /></button>
        </div>
      </header>
      <div className="window-body">
        <WindowNav id={win.id}>
          <Suspense fallback={<Loading />}><app.Component /></Suspense>
        </WindowNav>
      </div>
      {!win.maximized && (
        <>
          <div className="edge edge-e" onPointerDown={onEdgeDown('e')} onPointerMove={onEdgeMove} onPointerUp={onEdgeUp} />
          <div className="edge edge-s" onPointerDown={onEdgeDown('s')} onPointerMove={onEdgeMove} onPointerUp={onEdgeUp} />
          <div className="edge edge-se" onPointerDown={onEdgeDown('se')} onPointerMove={onEdgeMove} onPointerUp={onEdgeUp} />
        </>
      )}
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
