import { useEffect, type RefObject } from 'react';

// j and k move between the items on screen, in the order they appear. Each item is focusable and
// marked data-nav, so a screen reader follows along and the keyboard user can still Tab normally.
export function useListKeys(container: RefObject<HTMLElement | null>, extra: Record<string, () => void> = {}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const root = container.current;
      if (!root) return;
      if (e.key === 'j' || e.key === 'k') {
        const items = [...root.querySelectorAll<HTMLElement>('[data-nav]')];
        if (items.length === 0) return;
        const at = items.findIndex((i) => i === document.activeElement || i.contains(document.activeElement));
        const next = e.key === 'j' ? Math.min(at + 1, items.length - 1) : Math.max(at - 1, 0);
        items[at === -1 && e.key === 'k' ? items.length - 1 : next]?.focus();
        e.preventDefault();
        return;
      }
      const handler = extra[e.key];
      if (handler) { e.preventDefault(); handler(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
}
