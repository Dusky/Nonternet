import { create } from 'zustand';
import { mudClientSchema, type MudClient } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api, ApiError } from '../../api';
import { desktopSupported, playChime } from '../../alerts';
import { backoffMs, wasDropped } from '../../reconnect';
import { expand, runTriggers, type Highlight } from './engine';
import { plainText } from './markup';

// One connection to the MUD for the whole shell (docs/09), shared by its window and page. Evennia's WebSocket speaks
// JSON frames: ["text", ["…"], {}] both ways, ["logged_in", …], and the game's own vitals, room_info and area_map
// (services/mud/world/oob.py). The person's rules (aliases, triggers, timers, keys, buttons, variables) are kept on
// their account (client_settings, "mud") and run here, in the browser.

export interface Line {
  id: number; time: number; kind: 'game' | 'you' | 'note'; text: string; key?: StringKey;
  gagged?: number[]; highlights?: Record<number, Highlight[]>; // per line of the block, from triggers
}
export interface CaptureLine { id: number; time: number; text: string }
export type Status = 'idle' | 'connecting' | 'playing' | 'reconnecting' | 'closed' | 'error';
export interface Vitals { hp: number; hp_max: number; level: number; xp: number; xp_prev?: number; xp_next: number; coins: number; weakened: boolean; in_combat: boolean }
export interface Exit { name: string; aliases: string[]; to: number | null }
export interface RoomInfo { id: number; name: string; area: { key: string; name: string } | null; coord: [number, number, number] | null; exits: Exit[] }
export interface MapRoom { id: number; name: string; coord: [number, number, number]; exits: Exit[] }

interface MudState {
  status: Status; error: string | null; lines: Line[];
  vitals: Vitals | null; room: RoomInfo | null; map: { area: string | null; rooms: Record<number, MapRoom> };
  windows: Record<string, CaptureLine[]>; unseen: Record<string, number>;
  settings: MudClient; loaded: boolean; saveError: boolean;
  connect(): void; disconnect(): void;
  send(typed: string): void;          // what the person typed: through aliases and speedwalk
  sendRaw(cmd: string): void;         // one command, exactly
  save(next: MudClient): void;        // keeps the rules on the account (debounced)
  remember(typed: string): void;      // command history, kept on the account
  clear(): void;
  seen(window: string): void;
}

export const MAX_LINES = 2000;
const MAX_CAPTURE = 500;
const TRIGGER_BUDGET = 40; // commands triggers may send per 10 s, so two rules can't ping-pong forever
const DEFAULTS = mudClientSchema.parse({});
let ws: WebSocket | null = null;
let users = 0;
let seq = 0;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let timers: ReturnType<typeof setInterval>[] = [];
let budget = { since: 0, used: 0 };

export const useMud = create<MudState>((set, get) => {
  const push = (line: Omit<Line, 'id' | 'time'>) => set((s) => {
    const lines = [...s.lines, { id: ++seq, time: Date.now(), ...line }];
    return { lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines };
  });
  const note = (key: StringKey) => push({ kind: 'note', text: '', key });
  const frame = (cmd: string, args: unknown[], opts: object = {}) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify([cmd, args, opts])); };
  const out = (cmd: string) => frame('text', [cmd]);
  const clientOptions = () => frame('client_options', [], { raw: true, ansi: true, xterm256: true, mxp: false, screenreader: get().settings.options.screenreader });

  // What the game said: triggers look at each line (colours removed) and may hide, colour, copy or answer it.
  const game = (text: string) => {
    const { settings } = get();
    const plain = plainText(text).split('\n');
    const gagged: number[] = [];
    const highlights: Record<number, Highlight[]> = {};
    const sends: string[] = [];
    let vars = settings.variables;
    let varsChanged = false;
    plain.forEach((l, i) => {
      if (!l.trim()) return;
      const r = runTriggers(l, settings.triggers, vars);
      if (!r) return;
      if (r.gag) gagged.push(i);
      if (r.highlights.length) highlights[i] = r.highlights;
      if (Object.keys(r.set).length) { vars = { ...vars, ...r.set }; varsChanged = true; }
      for (const w of r.capture) capture(w, l);
      if (r.beep) playChime();
      if (r.notify) notify(l);
      sends.push(...r.send);
    });
    push({ kind: 'game', text, ...(gagged.length ? { gagged } : {}), ...(Object.keys(highlights).length ? { highlights } : {}) });
    if (varsChanged) get().save({ ...get().settings, variables: vars });
    for (const s of sends) triggered(s);
  };
  const capture = (window: string, text: string) => set((s) => {
    const list = [...(s.windows[window] ?? []), { id: ++seq, time: Date.now(), text }];
    return { windows: { ...s.windows, [window]: list.slice(-MAX_CAPTURE) }, unseen: { ...s.unseen, [window]: (s.unseen[window] ?? 0) + 1 } };
  });
  const notify = (body: string) => {
    const looking = document.visibilityState === 'visible' && document.hasFocus();
    if (looking || !desktopSupported() || Notification.permission !== 'granted') return;
    try { new Notification(document.title, { body: body.slice(0, 120), tag: 'mud' }); } catch { /* the line is still in the log */ }
  };
  const triggered = (typed: string) => {
    const now = Date.now();
    if (now - budget.since > 10_000) budget = { since: now, used: 0 };
    const cmds = expand(typed, get().settings);
    if (budget.used + cmds.length > TRIGGER_BUDGET) { if (budget.used <= TRIGGER_BUDGET) note('mud.note.triggerFlood'); budget.used = TRIGGER_BUDGET + 1; return; }
    budget.used += cmds.length;
    for (const c of cmds) { if (get().settings.options.echo) push({ kind: 'you', text: c }); out(c); }
  };

  const room = (info: RoomInfo) => set((s) => {
    const area = info.area?.key ?? null;
    let rooms = area === s.map.area ? s.map.rooms : {};
    if (area !== s.map.area && area) frame('area_map', []); // a new area: ask for the rooms of it we have seen before
    if (info.coord) rooms = { ...rooms, [info.id]: { id: info.id, name: info.name, coord: info.coord, exits: info.exits } };
    return { room: info, map: { area, rooms } };
  });

  const restartTimers = () => {
    timers.forEach(clearInterval);
    timers = [];
    if (get().status !== 'playing') return;
    for (const t of get().settings.timers) {
      if (!t.enabled) continue;
      timers.push(setInterval(() => { if (get().status === 'playing') triggered(t.send); }, t.every * 1000));
    }
  };

  // Opens one connection to the world (a one-use ticket logs the character in).
  const open = () => {
    set({ status: 'connecting', error: null });
    void (async () => {
      let t: { ticket: string; nick: string };
      try {
        t = await api.post<{ ticket: string; nick: string }>('/mud/ticket', {});
      } catch (e) {
        if (e instanceof ApiError && e.status === 0 && users > 0) return scheduleRetry(); // no network: keep trying
        set({ status: 'error', error: e instanceof ApiError ? e.message : null });
        return;
      }
      if (users === 0) return;
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/mud`);
      ws = socket;
      let greeted = false;
      socket.onmessage = (e) => {
        let msg: [string, unknown[], Record<string, unknown>];
        try { msg = JSON.parse(String(e.data)); } catch { return; }
        const [cmd, args, kwargs] = msg;
        if (cmd === 'text' || cmd === 'prompt') {
          if (!greeted) {
            // Evennia drops input sent before its session is ready; its welcome screen says it is.
            // VERIFIED against Evennia 5.0.1. The welcome screen itself is not shown.
            greeted = true;
            clientOptions();
            out(`connect ${t.nick} ${t.ticket}`);
            return;
          }
          game(String(args[0] ?? ''));
        } else if (cmd === 'logged_in') {
          attempt = 0;
          set({ status: 'playing' });
          restartTimers();
          frame('vitals_get', []);
          frame('room_get', []);
        } else if (cmd === 'vitals') set({ vitals: kwargs as unknown as Vitals });
        else if (cmd === 'room_info') room(kwargs as unknown as RoomInfo);
        else if (cmd === 'area_map') {
          const m = kwargs as unknown as { area: { key: string } | null; rooms: MapRoom[] };
          set((s) => (m.area?.key === s.map.area ? { map: { area: s.map.area, rooms: { ...Object.fromEntries(m.rooms.map((r) => [r.id, r])), ...s.map.rooms } } } : {}));
        }
      };
      socket.onclose = (ev) => {
        if (ws === socket) ws = null;
        restartTimers();
        // A lost connection comes back by itself; quitting (or being sent away) stays closed.
        if (users > 0 && wasDropped(ev.code)) { note('mud.note.dropped'); return scheduleRetry(); }
        set((s) => ({ status: s.status === 'error' ? 'error' : 'closed' }));
        restartTimers();
        note('mud.note.closed');
      };
    })();
  };
  const scheduleRetry = () => {
    set({ status: 'reconnecting' });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (users > 0 && !ws) open(); }, backoffMs(attempt++));
  };

  return {
    status: 'idle', error: null, lines: [], vitals: null, room: null, map: { area: null, rooms: {} },
    windows: {}, unseen: {}, settings: DEFAULTS, loaded: false, saveError: false,

    connect() {
      users++;
      if (!get().loaded) {
        void api.get<{ settings: MudClient }>('/me/client-settings/mud')
          .then((r) => { set({ settings: r.settings, loaded: true }); restartTimers(); clientOptions(); })
          .catch(() => set({ loaded: true }));
      }
      if (ws) return;
      clearTimeout(retryTimer);
      attempt = 0;
      open();
    },

    disconnect() {
      users = Math.max(0, users - 1);
      if (users > 0) return;
      setTimeout(() => {
        if (users === 0 && ws) { out('quit'); ws.close(); ws = null; set({ status: 'idle' }); restartTimers(); }
      }, 1500);
    },

    send(typed) {
      if (get().status !== 'playing') return;
      const line = typed.replace(/[\r\n]+/g, ' ');
      if (!line.trim()) return;
      const { settings } = get();
      const cmds = expand(line, settings);
      // Show what was typed; if aliases turned it into something else, show that too, quietly.
      if (settings.options.echo) push({ kind: 'you', text: cmds.length === 1 && cmds[0] === line.trim() ? line.trim() : `${line.trim()}  → ${cmds.join(settings.options.separator + ' ')}` });
      for (const c of cmds) out(c.slice(0, 500));
    },

    sendRaw(cmd) {
      if (get().status !== 'playing' || !cmd.trim()) return;
      if (get().settings.options.echo) push({ kind: 'you', text: cmd.trim() });
      out(cmd.trim().slice(0, 500));
    },

    save(next) {
      const before = get().settings;
      set({ settings: next, saveError: false });
      if (next.timers !== before.timers) restartTimers();
      if (next.options.screenreader !== before.options.screenreader) clientOptions();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void api.put('/me/client-settings/mud', { settings: get().settings }).catch(() => set({ saveError: true }));
      }, 800);
    },

    remember(typed) {
      const t = typed.trim();
      if (!t) return;
      const s = get().settings;
      if (s.history[0] === t) return;
      // The history is saved a little later with anything else that changed, never on every keypress.
      get().save({ ...s, history: [t, ...s.history.filter((h) => h !== t)].slice(0, 200) });
    },

    clear() { set({ lines: [] }); },
    seen(window) { set((s) => ({ unseen: { ...s.unseen, [window]: 0 } })); },
  };
});
