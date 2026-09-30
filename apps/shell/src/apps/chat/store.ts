import { create } from 'zustand';
import { Buffer as NodeBuffer } from 'buffer';
import { Client } from 'irc-framework';
import { api, ApiError } from '../../api';
import type { StringKey } from '@app/strings';
import { mentions } from './format';

// One connection to IRC for the whole shell (docs/08), shared by the Chat window and page. It opens
// when the Chat app does and closes when the last view of it goes away.

export type MsgKind = 'message' | 'action' | 'notice' | 'join' | 'part' | 'quit' | 'kick' | 'nick' | 'topic' | 'info' | 'error';
// `key` is a UI string shown instead of `text` (our own notes); `text` is what came from IRC.
export interface Msg { id: string; time: number; kind: MsgKind; nick: string; text: string; self: boolean; mention: boolean; key?: StringKey }
export interface Buffer { name: string; kind: 'channel' | 'query' | 'server'; messages: Msg[]; users: Map<string, string>; topic: string; unread: number; mentioned: boolean; joined: boolean }
export type Status = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

interface ChatState {
  status: Status; error: string | null; nick: string; active: string; buffers: Map<string, Buffer>; muted: Set<string>;
  connect(): void; disconnect(): void; select(name: string): void; send(text: string): void; join(name: string): void; part(name: string): void; toggleMute(name: string): void;
}

// irc-framework's browser build expects Node's global Buffer (for SASL); Kiwi IRC provides it the same way.
const g = globalThis as { Buffer?: unknown };
g.Buffer ??= NodeBuffer;

const SERVER = '*';
const MAX_MESSAGES = 500;
const MUTED_KEY = 'chat:muted';
let client: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
let users = 0;
let seq = 0;
const leaving = new Set<string>(); // channels closed here; the server's PART must not bring them back
const key = (name: string) => name.toLowerCase();
const isChannel = (name: string) => /^[#&]/.test(name);

function loadMuted(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(MUTED_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function saveMuted(m: Set<string>) { try { localStorage.setItem(MUTED_KEY, JSON.stringify([...m])); } catch { /* private window */ } }

const newBuffer = (name: string, kind: Buffer['kind']): Buffer => ({ name, kind, messages: [], users: new Map(), topic: '', unread: 0, mentioned: false, joined: false });

export const useChat = create<ChatState>((set, get) => {
  // Every change makes new Map/Buffer objects so React sees it.
  const update = (name: string, fn: (b: Buffer) => Buffer, kind?: Buffer['kind']) => set((s) => {
    const buffers = new Map(s.buffers);
    const k = key(name);
    const cur = buffers.get(k) ?? newBuffer(name, kind ?? (isChannel(name) ? 'channel' : name === SERVER ? 'server' : 'query'));
    buffers.set(k, fn(cur));
    return { buffers };
  });

  const add = (target: string, m: Omit<Msg, 'id' | 'mention' | 'self' | 'key'> & { msgid?: string; history?: boolean; key?: StringKey }) => {
    const { nick, active, muted } = get();
    const self = key(m.nick) === key(nick);
    const mention = !self && (m.kind === 'message' || m.kind === 'action') && (!isChannel(target) || mentions(m.text, nick));
    update(target, (b) => {
      const id = m.msgid ?? `l${++seq}`;
      if (m.msgid && b.messages.some((x) => x.id === id)) return b; // history and live can overlap
      let messages = [...b.messages, { id, time: m.time, kind: m.kind, nick: m.nick, text: m.text, self, mention, ...(m.key ? { key: m.key } : {}) }];
      if (m.history) messages.sort((a, c) => a.time - c.time);
      if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
      const counts = !m.history && key(target) !== key(active) && (m.kind === 'message' || m.kind === 'action' || m.kind === 'notice');
      return { ...b, messages, unread: counts ? b.unread + 1 : b.unread, mentioned: b.mentioned || (counts && mention && !muted.has(key(target))) };
    });
  };
  const info = (text: string, kind: MsgKind = 'info', target = get().active) => add(target, { time: Date.now(), kind, nick: '', text });
  const note = (key: StringKey, kind: MsgKind = 'info', target = get().active) => add(target, { time: Date.now(), kind, nick: '', text: '', key });

  const timeOf = (e: { time?: number; tags?: Record<string, string> }) => (e.tags?.time ? Date.parse(e.tags.time) : e.time ?? Date.now());
  const inHistory = (e: { batch?: { type?: string } }) => e.batch?.type === 'chathistory';

  return {
    status: 'idle', error: null, nick: '', active: SERVER, buffers: new Map([[SERVER, newBuffer(SERVER, 'server')]]), muted: loadMuted(),

    connect() {
      users++;
      if (client) return;
      set({ status: 'connecting', error: null });
      void (async () => {
        let t: { ticket: string; nick: string };
        try {
          t = await api.post<{ ticket: string; nick: string }>('/irc/ticket', {});
        } catch (e) {
          set({ status: 'error', error: e instanceof ApiError ? e.message : null });
          return;
        }
        if (users === 0) return;
        const c = new Client();
        client = c;
        c.requestCap(['draft/chathistory', 'draft/event-playback']);
        set({ nick: t.nick });
        c.on('registered', () => { set({ status: 'connected', nick: c.user.nick }); note('chat.note.connected', 'info', SERVER); });
        c.on('join', (e: any) => {
          if (inHistory(e)) return add(e.channel, { time: timeOf(e), kind: 'join', nick: e.nick, text: '', msgid: e.tags?.msgid, history: true });
          if (key(e.nick) === key(get().nick)) {
            update(e.channel, (b) => ({ ...b, joined: true }), 'channel');
            if (get().active === SERVER) set({ active: key(e.channel) });
            c.raw(`CHATHISTORY LATEST ${e.channel} * 100`);
          } else {
            update(e.channel, (b) => { const u = new Map(b.users); u.set(e.nick, ''); return { ...b, users: u }; });
          }
          add(e.channel, { time: timeOf(e), kind: 'join', nick: e.nick, text: '', msgid: e.tags?.msgid });
        });
        c.on('part', (e: any) => {
          if (inHistory(e)) return;
          if (key(e.nick) === key(get().nick) && leaving.delete(key(e.channel))) return;
          if (key(e.nick) === key(get().nick)) update(e.channel, (b) => ({ ...b, joined: false, users: new Map() }));
          else update(e.channel, (b) => { const u = new Map(b.users); u.delete(e.nick); return { ...b, users: u }; });
          add(e.channel, { time: timeOf(e), kind: 'part', nick: e.nick, text: e.message ?? '', msgid: e.tags?.msgid });
        });
        c.on('kick', (e: any) => {
          update(e.channel, (b) => { const u = new Map(b.users); u.delete(e.kicked); return key(e.kicked) === key(get().nick) ? { ...b, joined: false, users: new Map() } : { ...b, users: u }; });
          add(e.channel, { time: timeOf(e), kind: 'kick', nick: e.nick, text: `${e.kicked}${e.message ? `: ${e.message}` : ''}` });
        });
        c.on('quit', (e: any) => {
          for (const b of get().buffers.values()) {
            if (!b.users.has(e.nick)) continue;
            update(b.name, (x) => { const u = new Map(x.users); u.delete(e.nick); return { ...x, users: u }; });
            add(b.name, { time: timeOf(e), kind: 'quit', nick: e.nick, text: e.message ?? '', msgid: e.tags?.msgid });
          }
        });
        c.on('nick', (e: any) => {
          for (const b of get().buffers.values()) {
            if (!b.users.has(e.nick)) continue;
            update(b.name, (x) => { const u = new Map(x.users); const p = u.get(e.nick) ?? ''; u.delete(e.nick); u.set(e.new_nick, p); return { ...x, users: u }; });
            add(b.name, { time: timeOf(e), kind: 'nick', nick: e.nick, text: e.new_nick });
          }
        });
        c.on('userlist', (e: any) => update(e.channel, (b) => ({ ...b, users: new Map(e.users.map((u: { nick: string; modes: string[] }) => [u.nick, prefixOf(u.modes)])) })));
        c.on('mode', (e: any) => {
          if (!isChannel(e.target)) return;
          update(e.target, (b) => {
            const u = new Map(b.users);
            for (const m of e.modes as { mode: string; param?: string }[]) {
              if (!m.param || !u.has(m.param) || !/[qaohv]/.test(m.mode[1] ?? '')) continue;
              const cur = u.get(m.param) ?? '';
              const sym = PREFIX[m.mode[1] as keyof typeof PREFIX];
              const next = m.mode[0] === '+' ? (rank(sym) < rank(cur) ? sym : cur) : (cur === sym ? '' : cur);
              u.set(m.param, next);
            }
            return { ...b, users: u };
          });
        });
        c.on('topic', (e: any) => {
          update(e.channel, (b) => ({ ...b, topic: e.topic ?? '' }));
          if (e.nick) add(e.channel, { time: timeOf(e), kind: 'topic', nick: e.nick, text: e.topic ?? '', msgid: e.tags?.msgid });
        });
        const onMessage = (e: any) => {
          if (e.type === 'notice' && (!e.target || e.target === '*' || !e.nick || e.nick.includes('.'))) return info(e.message, 'notice', SERVER);
          const self = key(e.nick) === key(get().nick);
          const target = isChannel(e.target) ? e.target : self ? e.target : e.nick;
          const kind: MsgKind = e.type === 'action' ? 'action' : e.type === 'notice' ? 'notice' : 'message';
          add(target, { time: timeOf(e), kind, nick: e.nick, text: e.message, msgid: e.tags?.msgid, history: inHistory(e) });
        };
        c.on('privmsg', onMessage);
        c.on('action', onMessage);
        c.on('notice', onMessage);
        c.on('irc error', (e: any) => (e.reason ? info(e.reason, 'error') : note('chat.note.error', 'error')));
        c.on('close', () => { client = null; set((s) => ({ status: s.status === 'error' ? 'error' : 'closed', buffers: new Map([...s.buffers].map(([k, b]) => [k, { ...b, joined: false, users: new Map() }])) })); });
        const secure = location.protocol === 'https:';
        c.connect({
          host: location.hostname, port: Number(location.port || (secure ? 443 : 80)), tls: secure, path: '/ws/irc',
          nick: t.nick, username: t.nick, gecos: t.nick, account: { account: t.nick, password: t.ticket },
          // Our own lines come back from the server, with its time and id, so history and live never double up.
          enable_echomessage: true, auto_reconnect: false, message_max_length: 400,
        });
      })();
    },

    disconnect() {
      users = Math.max(0, users - 1);
      if (users > 0) return;
      // A moment's grace, so switching between window and page doesn't reconnect.
      setTimeout(() => { if (users === 0 && client) { client.quit('Closed the chat'); client = null; set({ status: 'idle' }); } }, 1500);
    },

    select(name) {
      set({ active: key(name) });
      update(name, (b) => ({ ...b, unread: 0, mentioned: false }));
    },

    join(name) {
      const ch = name.trim().startsWith('#') ? name.trim() : `#${name.trim()}`;
      if (!client || !/^#[^\s,]{1,63}$/.test(ch)) return note('chat.note.badChannel', 'error');
      client.join(ch);
      set({ active: key(ch) });
    },

    part(name) {
      if (client && isChannel(name)) { leaving.add(key(name)); client.part(name); }
      set((s) => { const buffers = new Map(s.buffers); buffers.delete(key(name)); return { buffers, active: SERVER }; });
    },

    toggleMute(name) {
      set((s) => { const muted = new Set(s.muted); if (muted.has(key(name))) muted.delete(key(name)); else muted.add(key(name)); saveMuted(muted); return { muted }; });
    },

    send(raw) {
      const text = raw.replace(/[\r\n]+/g, ' ');
      if (!text.trim() || !client) return;
      const { active, buffers } = get();
      const buf = buffers.get(active);
      const target = buf && buf.kind !== 'server' ? buf.name : null;
      if (text.startsWith('/') && !text.startsWith('//')) {
        const [cmd = '', ...rest] = text.slice(1).split(' ');
        const arg = rest.join(' ');
        switch (cmd.toLowerCase()) {
          case 'join': case 'j': return get().join(rest[0] ?? '');
          case 'part': case 'leave': return target ? get().part(target) : note('chat.note.openFirst', 'error');
          case 'me': if (target && arg) client.action(target, arg); return;
          case 'msg': case 'query': {
            const [to, ...words] = rest;
            if (!to) return note('chat.note.msgWho', 'error');
            update(to, (b) => b, 'query');
            set({ active: key(to) });
            if (words.length) client.say(to, words.join(' '));
            return;
          }
          case 'topic': if (target && isChannel(target)) client.setTopic(target, arg); return;
          case 'nick': return note('chat.note.nick', 'error');
          default: return note('chat.note.unknown', 'error');
        }
      }
      if (!target) return note('chat.note.pick', 'error');
      client.say(target, text.startsWith('//') ? text.slice(1) : text);
    },
  };
});

const PREFIX = { q: '~', a: '&', o: '@', h: '%', v: '+' } as const;
const ORDER = ['~', '&', '@', '%', '+', ''];
const rank = (p: string) => ORDER.indexOf(p);
function prefixOf(modes: string[]): string {
  const p = (modes ?? []).map((m) => PREFIX[m as keyof typeof PREFIX] ?? m).filter((m) => ORDER.includes(m));
  return p.sort((a, b) => rank(a) - rank(b))[0] ?? '';
}
export const sortedUsers = (b: Buffer) => [...b.users].sort(([an, ap], [bn, bp]) => rank(ap) - rank(bp) || an.localeCompare(bn, undefined, { sensitivity: 'base' }));
