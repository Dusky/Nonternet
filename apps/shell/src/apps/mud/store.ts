import { create } from 'zustand';
import type { StringKey } from '@app/strings';
import { api, ApiError } from '../../api';
import { backoffMs, wasDropped } from '../../reconnect';

// One connection to the MUD for the whole shell (docs/09), shared by its window and page. Evennia's
// WebSocket speaks JSON frames: ["text", ["…"], {}] out and in, plus ["logged_in", …].
export interface Line { id: number; text: string; kind: 'game' | 'you' | 'note'; key?: StringKey }
export type Status = 'idle' | 'connecting' | 'playing' | 'reconnecting' | 'closed' | 'error';

interface MudState {
  status: Status; error: string | null; lines: Line[];
  connect(): void; disconnect(): void; send(text: string): void;
}

const MAX_LINES = 1000;
let ws: WebSocket | null = null;
let users = 0;
let seq = 0;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

export const useMud = create<MudState>((set, get) => {
  const push = (text: string, kind: Line['kind'] = 'game', key?: StringKey) => set((s) => {
    const lines = [...s.lines, { id: ++seq, text, kind, ...(key ? { key } : {}) }];
    return { lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines };
  });
  const frame = (cmd: string, arg: string, opts: object = {}) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify([cmd, [arg], opts]));

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
        const [cmd, args] = msg;
        if (cmd === 'text' || cmd === 'prompt') {
          if (!greeted) {
            // Evennia drops input sent before its session is ready; its welcome screen says it is.
            // VERIFIED against Evennia 5.0.1. The welcome screen itself is not shown.
            greeted = true;
            frame('client_options', '', { raw: true, ansi: true, xterm256: true, mxp: false, screenreader: false });
            frame('text', `connect ${t.nick} ${t.ticket}`);
            return;
          }
          push(String(args[0] ?? ''));
        } else if (cmd === 'logged_in') {
          attempt = 0;
          set({ status: 'playing' });
        }
      };
      socket.onclose = (ev) => {
        if (ws === socket) ws = null;
        // A lost connection comes back by itself; quitting (or being sent away) stays closed.
        if (users > 0 && wasDropped(ev.code)) { push('', 'note', 'mud.note.dropped'); return scheduleRetry(); }
        set((s) => ({ status: s.status === 'error' ? 'error' : 'closed' }));
        push('', 'note', 'mud.note.closed');
      };
    })();
  };
  const scheduleRetry = () => {
    set({ status: 'reconnecting' });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (users > 0 && !ws) open(); }, backoffMs(attempt++));
  };

  return {
    status: 'idle', error: null, lines: [],

    connect() {
      users++;
      if (ws) return;
      clearTimeout(retryTimer);
      attempt = 0;
      open();
    },

    disconnect() {
      users = Math.max(0, users - 1);
      if (users > 0) return;
      setTimeout(() => { if (users === 0 && ws) { frame('text', 'quit'); ws.close(); ws = null; set({ status: 'idle' }); } }, 1500);
    },

    send(raw) {
      const text = raw.replace(/[\r\n]+/g, ' ').trim();
      if (!text || get().status !== 'playing') return;
      push(text, 'you');
      frame('text', text);
    },
  };
});
