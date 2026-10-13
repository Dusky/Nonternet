import { create } from 'zustand';
import { en } from '@app/strings';
import { desktopClientSchema, type DesktopClient } from '@app/shared';
import { api } from '../api';
import { toast } from '../components/feedback';
import { NEVER_HIDDEN, phoneOrder, shiftPhone } from './desktopLayout.logic';

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
  reset: () => DesktopClient;
  restore: (s: DesktopClient) => void;
}

const empty = (): DesktopClient => desktopClientSchema.parse({});
let timer: ReturnType<typeof setTimeout> | undefined;
let loading: Promise<void> | null = null;

export const useDesktopLayout = create<State>((set, get) => {
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
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
    reset: () => { const before = get().settings; if (get().loaded) apply(empty()); return before; },
    restore: (s) => { if (get().loaded) apply(s); },
  };
});

// The apps to show on the desktop or the phone grid: hidden ones left out, the phone order applied.
export function shownApps<T extends { id: string }>(apps: T[], s: DesktopClient, phone: boolean): T[] {
  const visible = apps.filter((a) => !s.hidden.includes(a.id));
  return phone ? phoneOrder(visible, s.phone_order) : visible;
}
