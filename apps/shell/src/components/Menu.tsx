import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Menu, MenuItem as AriaMenuItem, MenuTrigger, Popover, Separator, type Placement } from 'react-aria-components';

// Menus, built on React Aria so they all behave the same way: arrow keys, Home and End move between items,
// typing a letter jumps to the item that starts with it, Escape and a click elsewhere close the menu, and focus
// goes back to whatever opened it. They are styled with our own CSS (.menu).

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  /** A line above this item. */
  separator?: boolean;
}

function Items({ items }: { items: MenuEntry[] }) {
  return (
    <>
      {items.map((it) => [
        it.separator ? <Separator key={`${it.label}-sep`} className="menu-sep" /> : null,
        <AriaMenuItem
          key={it.label} id={it.label} textValue={it.label} isDisabled={it.disabled} onAction={it.onSelect}
          className={`menu-item${it.danger ? ' is-danger' : ''}`}
        >{it.icon}{it.label}</AriaMenuItem>,
      ])}
    </>
  );
}

// A button that opens a menu under it.
export function MenuButton({ label, children, items, className = 'btn btn-quiet', menuClassName, placement = 'bottom start', ariaLabel }: {
  label: string;
  /** What the button shows, if not just the label. */
  children?: ReactNode;
  items: MenuEntry[];
  className?: string;
  menuClassName?: string;
  placement?: Placement;
  ariaLabel?: string;
}) {
  return (
    <MenuTrigger>
      <Button className={`${className} has-menu`} aria-label={ariaLabel}>{children ?? label}</Button>
      <Popover placement={placement} offset={6} className="menu-popover">
        <Menu className={`menu${menuClassName ? ` ${menuClassName}` : ''}`} aria-label={ariaLabel ?? label} autoFocus="first">
          <Items items={items} />
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export type MenuItem = MenuEntry;

// A menu that opens where you right-click, or under the element with Shift+F10 or the Menu key, so it can be
// reached without a mouse. Spread `bind` onto the element the menu belongs to, and render `menu` anywhere.
export function useContextMenu(items: () => MenuEntry[]): {
  bind: { onContextMenu: (e: React.MouseEvent) => void; onKeyDown: (e: React.KeyboardEvent) => void };
  menu: ReactNode;
} {
  const [at, setAt] = useState<{ x: number; y: number; list: MenuEntry[] } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  // A window that loses focus or changes size leaves the menu pointing at the wrong place.
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [at]);

  const bind = {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).focus();
      setAt({ x: e.clientX, y: e.clientY, list: items() });
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
      e.preventDefault();
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setAt({ x: r.left + 8, y: r.bottom, list: items() });
    },
  };

  const menu = at && createPortal(
    <>
      <span ref={anchor} aria-hidden="true" style={{ position: 'fixed', left: at.x, top: at.y, width: 0, height: 0 }} />
      <Popover triggerRef={anchor} isOpen onOpenChange={(open) => { if (!open) setAt(null); }} placement="bottom start" offset={0} className="menu-popover">
        <Menu className="menu context-menu" aria-label={at.list[0]?.label} autoFocus="first" onClose={() => setAt(null)}>
          <Items items={at.list} />
        </Menu>
      </Popover>
    </>,
    document.body,
  );

  return { bind, menu };
}
