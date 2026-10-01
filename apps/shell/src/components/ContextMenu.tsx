import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMenuKeys } from '../shell/menuKeys';

export interface MenuItem { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }

// A menu that opens where you right-click, or under the element with Shift+F10 or the Menu key, so it can be
// reached without a mouse. Escape closes it and puts focus back; arrows, Home and End move between items.
// Spread `bind` onto the element the menu belongs to, and render `menu` anywhere.
export function useContextMenu(items: () => MenuItem[]): {
  bind: { onContextMenu: (e: MouseEvent) => void; onKeyDown: (e: KeyboardEvent) => void };
  menu: ReactNode;
} {
  const [at, setAt] = useState<{ x: number; y: number; list: MenuItem[] } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setAt(null), []);
  useMenuKeys(list, at !== null, close, trigger);

  useEffect(() => {
    if (!at) return;
    const away = (e: Event) => { if (!list.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', away);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [at, close]);

  const bind = {
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      trigger.current = e.currentTarget as HTMLElement;
      setAt({ x: e.clientX, y: e.clientY, list: items() });
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      trigger.current = el;
      const r = el.getBoundingClientRect();
      setAt({ x: r.left + 8, y: r.bottom, list: items() });
    },
  };

  const menu = at && createPortal(
    <ul
      ref={list} className="menu context-menu" role="menu"
      style={{ left: Math.min(at.x, window.innerWidth - 220), top: Math.min(at.y, window.innerHeight - at.list.length * 46 - 16) }}
    >
      {at.list.map((it) => (
        <li key={it.label} role="none">
          <button type="button" role="menuitem" disabled={it.disabled} className={it.danger ? 'is-danger' : undefined} onClick={() => { close(); trigger.current?.focus(); it.onSelect(); }}>{it.label}</button>
        </li>
      ))}
    </ul>,
    document.body,
  );

  return { bind, menu };
}
