import { create } from 'zustand';
import { en } from '@app/strings';
import { DESKTOP_MAX_SHORTCUTS, desktopClientSchema, type DesktopClient, type WidgetChoice } from '@app/shared';
import { api } from '../api';
import { toast } from '../components/feedback';
import { NEVER_HIDDEN, newShortcutId, resolveWidgets, phoneOrder, sameTarget, shiftPhone, shortcutKey, type ShortcutTarget } from './desktopLayout.logic';

// The desktop layout as the account keeps it (docs/10): where icons sit, what is hidden, the phone order. Loaded once after
// sign-in; changes show at once and are saved a moment later, and nothing is saved before the first load, so the defaults can
// never overwrite what someone arranged (the same rule the MUD client follows).
interface State {
  settings: DesktopClient;
  loaded: boolean;
  load: () => Promise<void>;
  update: (fn: (s: DesktopClient) => DesktopClient) => void;
  hide: (id: string) => void;
  show: (id: string) => void;
  shiftPhone: (items: { id: string }[], id: string, by: -1 | 1) => void;
  // Adds a shortcut, or says which one already points there. 'full' when there are as many as allowed.
  addShortcut: (label: string, target: ShortcutTarget) => { id: string; added: boolean } | 'full' | null;
  removeShortcut: (id: string) => void;
  renameShortcut: (id: string, label: string) => void;
  // The home panel's widgets. The first change turns the default list into the person's own.
  editingHome: boolean;
  setEditingHome: (on: boolean) => void;
  changeWidgets: (fn: (list: WidgetChoice[]) => WidgetChoice[], legacyStartHidden?: boolean) => void;
  reset: () => DesktopClient;
  restore: (s: DesktopClient) => void;
}

const empty = (): DesktopClient => desktopClientSchema.parse({});
let timer: ReturnType<typeof setTimeout> | undefined;
let loading: Promise<void> | null = null;
let pending: (() => void) | null = null;
// A change made just before leaving the page (a reload, closing the tab) is still sent: keepalive outlives the page.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { pending?.(); });

export const useDesktopLayout = create<State>((set, get) => {
  const save = () => {
    clearTimeout(timer);
    pending = () => {
      clearTimeout(timer); pending = null;
      if (!get().loaded) return;
      void fetch('/api/v1/me/client-settings/desktop', { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings: get().settings }) });
    };
    timer = setTimeout(() => {
      pending = null;
      if (!get().loaded) return;
      api.put('/me/client-settings/desktop', { settings: get().settings }).catch(() => toast(en['desktop.saveFailed'], 'error'));
    }, 800);
  };
  const apply = (settings: DesktopClient) => { set({ settings }); save(); };
  return {
    settings: empty(),
    loaded: false,
    load: () => (loading ??= api.get<{ settings: unknown }>('/me/client-settings/desktop')
      .then((r) => { const p = desktopClientSchema.safeParse(r.settings); set({ settings: p.success ? p.data : empty(), loaded: true }); })
      .catch(() => { set({ loaded: true }); })),
    update: (fn) => { if (get().loaded) apply(fn(get().settings)); },
    hide: (id) => { if (NEVER_HIDDEN.includes(id) || !get().loaded) return; const s = get().settings; if (!s.hidden.includes(id)) apply({ ...s, hidden: [...s.hidden, id] }); },
    show: (id) => { if (!get().loaded) return; const s = get().settings; apply({ ...s, hidden: s.hidden.filter((h) => h !== id) }); },
    shiftPhone: (items, id, by) => { if (get().loaded) apply({ ...get().settings, phone_order: shiftPhone(items, get().settings.phone_order, id, by) }); },
    addShortcut: (label, target) => {
      if (!get().loaded) return null;
      const s = get().settings;
      const found = s.shortcuts.find((x) => sameTarget(x.target, target));
      if (found) return { id: found.id, added: false };
      if (s.shortcuts.length >= DESKTOP_MAX_SHORTCUTS) return 'full';
      const id = newShortcutId();
      apply({ ...s, shortcuts: [...s.shortcuts, { id, label: label.trim().slice(0, 60) || '…', target }] });
      return { id, added: true };
    },
    removeShortcut: (id) => {
      if (!get().loaded) return;
      const s = get().settings;
      const { [shortcutKey(id)]: _gone, ...positions } = s.positions;
      apply({ ...s, shortcuts: s.shortcuts.filter((x) => x.id !== id), positions, phone_order: s.phone_order.filter((k) => k !== shortcutKey(id)) });
    },
    renameShortcut: (id, label) => {
      const l = label.trim().slice(0, 60);
      if (!get().loaded || !l) return;
      const s = get().settings;
      apply({ ...s, shortcuts: s.shortcuts.map((x) => (x.id === id ? { ...x, label: l } : x)) });
    },
    editingHome: false,
    setEditingHome: (editingHome) => set({ editingHome }),
    changeWidgets: (fn, legacy = false) => {
      if (!get().loaded) return;
      const s = get().settings;
      apply({ ...s, widgets_set: true, widgets: fn(resolveWidgets(s, legacy)) });
    },
    reset: () => { const before = get().settings; if (get().loaded) apply({ ...empty(), shortcuts: before.shortcuts }); return before; },
    restore: (s) => { if (get().loaded) apply(s); },
  };
});

// The apps to show on the desktop or the phone grid: hidden ones left out, the phone order applied.
export function shownApps<T extends { id: string }>(apps: T[], s: DesktopClient, phone: boolean): T[] {
  const visible = apps.filter((a) => !s.hidden.includes(a.id));
  return phone ? phoneOrder(visible, s.phone_order) : visible;
}
