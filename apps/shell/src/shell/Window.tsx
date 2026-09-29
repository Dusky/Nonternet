import { Suspense, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../hooks';
import { WindowNav } from '../nav';
import { appById } from './apps';
import { useWindows, type Win } from './windows';

const STEP = 16;

// One window on the desktop. It can be dragged by its title bar, resized from the right, bottom and
// corner, and moved or resized from the keyboard (arrow keys, with Shift to resize).
export function Window({ win, focused }: { win: Win; focused: boolean }) {
  const t = useT();
  const { focus, close, minimize, toggleMaximize, move, resize } = useWindows();
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
        className="window-title" tabIndex={0} onPointerDown={onTitleDown} onPointerMove={onTitleMove} onPointerUp={onTitleUp}
        onDoubleClick={() => toggleMaximize(win.id)} onKeyDown={onKey} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
      >
        <h2>{title}</h2>
        <div className="window-buttons">
          <button type="button" aria-label={t('window.minimize', { app: title })} onClick={() => minimize(win.id)}>&#8211;</button>
          <button type="button" aria-label={win.maximized ? t('window.restore', { app: title }) : t('window.maximize', { app: title })} onClick={() => toggleMaximize(win.id)}>{win.maximized ? '❐' : '□'}</button>
          <button type="button" aria-label={t('window.close', { app: title })} onClick={() => close(win.id)}>&#215;</button>
        </div>
      </header>
      <div className="window-body">
        <WindowNav>
          <Suspense fallback={<p className="pad">{t('common.loading')}</p>}><app.Component /></Suspense>
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
