import { useEffect, type RefObject } from 'react';

// Keyboard for a dropdown menu (WAI-ARIA menu button pattern): opening it focuses the first item,
// arrow keys, Home and End move between items, Escape closes it and puts focus back on the button,
// and Tab closes it and moves on as usual.
export function useMenuKeys(menu: RefObject<HTMLElement | null>, open: boolean, close: () => void, button: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      const go = (n: number) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus(); };
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key === 'Escape') { e.preventDefault(); close(); button.current?.focus(); }
      else if (e.key === 'Tab') close();
    };
    const el = menu.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
