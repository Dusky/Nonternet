import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, useSite, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { parseFormatting, type Segment } from './format';
import { usePrefs } from '../../devicePrefs';
import { completeNick, dayKey, dayLabel, typingNow, foldPresence, type Completion } from './helpers';
import { sortedUsers, useChat, type Buffer, type Msg } from './store';
import { useContextMenu } from '../../components/ContextMenu';
import { useConfirm, useToast } from '../../components/feedback';
import { nickColour, completeWord, splitPaste, COMMANDS } from './helpers';

interface ChannelInfo { name: string; kind: 'official' | 'ring' | 'user'; owner: string | null; ring: { slug: string; name: string } | null; users: number | null; topic: string | null }

export default function ChatApp() {
  const t = useT();
  const { status, error, connect, disconnect, setAlertText } = useChat();
  useEffect(() => { connect(); return () => disconnect(); }, [connect, disconnect]);
  useEffect(() => { setAlertText({ title: t('chat.alert.title'), mention: t('chat.alert.mention'), dm: t('chat.alert.dm') }); }, [setAlertText, t]);
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="app-content chat app-fill">
      {status === 'error' && <Alert kind="error">{error ?? t('chat.failed')}</Alert>}
      {status === 'closed' && (
        <Alert kind="info">{t('chat.closed')} <button type="button" className="link" onClick={() => { disconnect(); connect(); }}>{t('chat.reconnect')}</button></Alert>
      )}
      {status === 'connecting' && <p className="hint" role="status">{t('chat.connecting')}</p>}
      {status === 'reconnecting' && <p className="hint" role="status">{t('chat.reconnecting')}</p>}
      {status !== 'error' && <Chat />}
      <button type="button" className="link" aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}>{t('chat.nativeTitle')}</button>
      {showHelp && <NativeHelp />}
    </div>
  );
}

function NativeHelp() {
  const t = useT();
  const site = useSite();
  return (
    <div className="panel">
      <p>{t('chat.native', { host: site.irc.host, port: site.irc.port })}</p>
      <p><OpenAppLink app="settings" to="terminal">{t('chat.nativeSettings')}</OpenAppLink></p>
    </div>
  );
}

function Chat() {
  const t = useT();
  const { buffers, active, select, status, muted } = useChat();
  const list = [...buffers.values()].filter((b) => b.kind !== 'server' || b.messages.length > 0);
  const buf = buffers.get(active);
  const [showUsers, setShowUsers] = useState(false);
  return (
    <div className="chat-grid">
      <nav className="chat-buffers" aria-label={t('chat.channels')}>
        <ul className="plain">
          {list.map((b) => {
            const label = b.kind === 'server' ? t('chat.server') : b.name;
            const isMuted = muted.has(b.name.toLowerCase());
            return (
              <li key={b.name}>
                <button type="button" className={`chat-buf${b.name.toLowerCase() === active ? ' is-active' : ''}${b.mentioned ? ' is-mention' : ''}`}
                  aria-current={b.name.toLowerCase() === active ? 'page' : undefined} onClick={() => select(b.name)}>
                  <span>{label}</span>
                  {b.unread > 0 && (!isMuted || b.mentioned) && <span className="badge">{b.mentioned ? t('chat.mention', { count: b.unread }) : t('chat.unread', { count: b.unread })}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {status === 'connected' && <JoinBox />}
      </nav>
      <section className="chat-main" aria-label={buf?.kind === 'server' ? t('chat.server') : buf?.name ?? t('chat.server')}>
        {buf && buf.kind !== 'server' && <BufferHeader buf={buf} showUsers={showUsers} onToggleUsers={() => setShowUsers(!showUsers)} />}
        {buf && <Log buf={buf} />}
        {status === 'connected' && <Composer target={buf} />}
      </section>
      {buf?.kind === 'channel' && (
        <aside className={`chat-users${showUsers ? ' is-open' : ''}`} aria-label={t('chat.people', { count: buf.users.size })}>
          <h2>{t('chat.people', { count: buf.users.size })}</h2>
          <ul className="plain">{sortedUsers(buf).map(([nick, prefix]) => <NickItem key={nick} nick={nick} prefix={prefix} buf={buf} />)}</ul>
        </aside>
      )}
    </div>
  );
}
const PREFIX_NAME: Record<string, string> = { '~': 'owner', '&': 'admin', '@': 'op', '%': 'halfop', '+': 'voice' };

// One person in the channel's list. Clicking (or Shift+F10) opens what you can do: write to them, ask who they are,
// ignore them, and for channel operators give or take voice and op, or kick.
function NickItem({ nick, prefix, buf }: { nick: string; prefix: string; buf: Buffer }) {
  const t = useT();
  const { openQuery, send, ignore, settings, away, nick: me, select } = useChat();
  const mine = buf.users.get(me) ?? '';
  const isOp = ['~', '&', '@'].includes(mine);
  const ignored = settings.ignore.some((n) => n.toLowerCase() === nick.toLowerCase());
  const self = nick.toLowerCase() === me.toLowerCase();
  const run = (cmd: string) => { select(buf.name); send(cmd); };
  const ctx = useContextMenu(() => [
    ...(self ? [] : [{ label: t('chat.nick.message'), onSelect: () => openQuery(nick) }]),
    { label: t('chat.nick.whois'), onSelect: () => run(`/whois ${nick}`) },
    ...(self ? [] : [{ label: ignored ? t('chat.nick.unignore') : t('chat.nick.ignore'), onSelect: () => ignore(nick, !ignored) }]),
    ...(isOp && !self ? [
      { label: prefix === '+' ? t('chat.nick.devoice') : t('chat.nick.voice'), onSelect: () => run(`/${prefix === '+' ? 'devoice' : 'voice'} ${nick}`) },
      { label: prefix === '@' ? t('chat.nick.deop') : t('chat.nick.op'), onSelect: () => run(`/${prefix === '@' ? 'deop' : 'op'} ${nick}`) },
      { label: t('chat.nick.kick'), onSelect: () => run(`/kick ${nick}`), danger: true },
    ] : []),
  ]);
  const isAway = away.has(nick.toLowerCase());
  return (
    <li className={isAway ? 'is-away' : undefined}>
      <button type="button" className={`chat-person ${nickColour(nick)}`} aria-haspopup="menu" {...ctx.bind} onClick={(e) => ctx.bind.onContextMenu(e)}>
        <span className="chat-prefix" aria-label={prefix ? t(`chat.prefix.${PREFIX_NAME[prefix] ?? 'op'}` as never) : undefined}>{prefix}</span>{nick}
        {isAway && <span className="hint"> {t('chat.away')}</span>}
        {ignored && <span className="hint"> {t('chat.ignored')}</span>}
      </button>
      {ctx.menu}
    </li>
  );
}

function BufferHeader({ buf, showUsers, onToggleUsers }: { buf: Buffer; showUsers: boolean; onToggleUsers: () => void }) {
  const t = useT();
  const { muted, toggleMute, part } = useChat();
  const isMuted = muted.has(buf.name.toLowerCase());
  return (
    <header className="chat-head">
      <div>
        <h2>{buf.name}</h2>
        {buf.topic && <p className="hint chat-topic"><IrcText text={buf.topic} /></p>}
      </div>
      <div className="actions">
        {buf.kind === 'channel' && <button type="button" className="btn btn-quiet chat-users-toggle" aria-expanded={showUsers} onClick={onToggleUsers}>{t('chat.people', { count: buf.users.size })}</button>}
        <button type="button" className="btn btn-quiet" aria-pressed={isMuted} onClick={() => toggleMute(buf.name)}>{isMuted ? t('chat.unmute') : t('chat.mute')}</button>
        <button type="button" className="btn btn-quiet" onClick={() => part(buf.name)}>{buf.kind === 'channel' ? t('chat.leave') : t('chat.close')}</button>
      </div>
    </header>
  );
}

function Log({ buf }: { buf: Buffer }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const loadOlder = useChat((s) => s.loadOlder);
  const keep = useRef<number | null>(null); // the distance from the bottom to keep when older lines are added above
  const [away, setAway] = useState(false); // scrolled up from the newest lines
  const [quiet, setQuiet] = useState(true); // while history loads, don't read it out line by line
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (keep.current !== null) { el.scrollTop = el.scrollHeight - keep.current; keep.current = null; } // older lines arrived: stay put
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [buf.messages, buf.name]);
  useEffect(() => { setQuiet(true); const id = setTimeout(() => setQuiet(false), 1500); return () => clearTimeout(id); }, [buf.name]);
  // Typing notices expire on their own, so look again every couple of seconds while someone is typing.
  useEffect(() => { if (!buf.typing.size) return; const id = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(id); }, [buf.typing]);
  const who = typingNow(buf.typing, now);
  const [prefs] = usePrefs('chat');
  const words = { today: t('chat.today'), yesterday: t('chat.yesterday') };
  const rows: JSX.Element[] = [];
  let prevDay = '';
  const shown = foldPresence(buf.messages);
  for (const m of shown) {
    if (!prefs.joinPart && (m.kind === 'join' || m.kind === 'part' || m.kind === 'quit')) continue;
    const d = dayKey(m.time);
    if (d !== prevDay) { rows.push(<li key={`d${d}`} className="chat-day"><span>{dayLabel(m.time, Date.now(), words)}</span></li>); prevDay = d; }
    rows.push(<Line key={m.id} m={m} stamps={prefs.timestamps} />);
    if (buf.readUpTo === m.id && m !== shown[shown.length - 1]) rows.push(<li key="new" className="chat-new"><span>{t('chat.newMessages')}</span></li>);
  }
  return (
    <div className="chat-log-wrap">
      {/* A log region is announced politely by screen readers as lines arrive. It scrolls, so it can take focus. */}
      <div ref={ref} className="chat-log" role="log" aria-live={quiet ? 'off' : 'polite'} aria-label={t('chat.messages', { name: buf.kind === 'server' ? t('chat.server') : buf.name })} tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAway(!stick.current);
          if (el.scrollTop < 40 && !buf.loadingOlder && !buf.olderDone && buf.kind !== 'server') { keep.current = el.scrollHeight - el.scrollTop; loadOlder(buf.name); }
        }}>
        {buf.kind !== 'server' && <p className="hint chat-older">{buf.loadingOlder ? t('chat.loadingOlder') : buf.olderDone ? t('chat.beginning') : '\u00a0'}</p>}
        <ol className="plain">{rows}</ol>
      </div>
      {away && <button type="button" className="btn chat-jump" onClick={() => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setAway(false); } }}>{t('chat.jump')}</button>}
      <p className="hint chat-typing" role="status" aria-live="polite">{who.length > 0 ? t('chat.typing', { names: who.join(', '), count: who.length }) : '\u00a0'}</p>
    </div>
  );
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Line({ m, stamps }: { m: Msg; stamps: boolean }) {
  const t = useT();
  const openQuery = useChat((st) => st.openQuery);
  const Nick = ({ nick }: { nick: string }) => (m.self || !nick ? <span className={`chat-nick ${nickColour(nick)}`}>{nick}</span> : <button type="button" className={`chat-nick link ${nickColour(nick)}`} title={t('chat.messageNick', { nick })} onClick={() => openQuery(nick)}>{nick}</button>);
  const cls = `chat-line chat-k-${m.kind}${m.mention ? ' is-mention' : ''}${m.self ? ' is-self' : ''}`;
  const when = stamps ? <time className="chat-time" dateTime={new Date(m.time).toISOString()}>{time(m.time)}</time> : null;
  switch (m.kind) {
    case 'message': return <li className={cls}>{when} <Nick nick={m.nick} /> <IrcText text={m.text} /></li>;
    case 'action': return <li className={cls}>{when} <span aria-hidden="true">* </span><Nick nick={m.nick} /> <IrcText text={m.text} /></li>;
    case 'notice': return <li className={cls}>{when} <span className="chat-nick">-{m.nick || t('chat.server')}-</span> <IrcText text={m.text} /></li>;
    case 'info': case 'error': return <li className={cls}>{when} {m.key ? t(m.key) : <IrcText text={m.text} />}</li>;
    default: return <li className={cls}>{when} {t(`chat.event.${m.kind}` as never, { nick: m.nick, text: m.text ? `(${m.text})` : '' }).trim()}</li>;
  }
}

export function IrcText({ text }: { text: string }) {
  return <>{parseFormatting(text).map((s, i) => <Seg key={i} s={s} />)}</>;
}
function Seg({ s }: { s: Segment }) {
  const cls = [s.bold && 'irc-b', s.italic && 'irc-i', s.underline && 'irc-u', s.strike && 'irc-s', s.mono && 'irc-m', s.fg !== undefined && `irc-c${s.fg}`, s.bg !== undefined && `irc-bg${s.bg}`].filter(Boolean).join(' ');
  if (s.link) return <a className={cls || undefined} href={s.link} target="_blank" rel="noopener noreferrer nofollow ugc">{s.text}</a>;
  return cls ? <span className={cls}>{s.text}</span> : <>{s.text}</>;
}

function Composer({ target }: { target: Buffer | undefined }) {
  const t = useT();
  const send = useChat((s) => s.send);
  const me = useChat((s) => s.nick);
  const doneTyping = useChat((s) => s.doneTyping);
  const channels = useChat((s) => s.buffers);
  const confirm = useConfirm();
  const toast = useToast();
  const [text, setText] = useState('');
  const typing = useChat((st) => st.typing);
  const users = target?.users;
  const nicks = useMemo(() => (target && target.kind === 'channel' && users ? [...users.keys()] : target && target.kind === 'query' ? [target.name] : []), [target?.kind, target?.name, users]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = useRef<HTMLInputElement>(null);
  const comp = useRef<Completion | null>(null);
  const history = useRef<string[]>([]);
  const pos = useRef(-1);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!text.trim()) return; send(text); doneTyping(); history.current.unshift(text); pos.current = -1; setText(''); };
  // Pasting several lines asks first, then sends them one by one (a few at most), instead of squashing them into one.
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const lines = splitPaste(e.clipboardData.getData('text'));
    if (lines === null) return;
    e.preventDefault();
    if (lines.length > 10) { toast(t('chat.paste.tooMany')); return; }
    void confirm({ message: t('chat.paste.confirm', { count: lines.length }), confirmLabel: t('chat.paste.send') }).then((ok) => {
      if (!ok) return;
      lines.forEach((l, i) => setTimeout(() => send(l.startsWith('/') ? `/${l}` : l), i * 400));
    });
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      const caret = e.currentTarget.selectionStart ?? text.length;
      const word = /([^\s]*)$/.exec(text.slice(0, caret))![1]!;
      // A channel name, a /command at the start of the line, or a nick.
      const c = word.startsWith('#') ? completeWord(text, caret, [...channels.values()].filter((b) => b.kind === 'channel').map((b) => b.name), comp.current)
        : word.startsWith('/') && caret === word.length ? completeWord(text, caret, COMMANDS.map((x) => `/${x}`), comp.current)
        : completeNick(text, caret, nicks.filter((n) => n.toLowerCase() !== me.toLowerCase()), comp.current);
      if (c) {
        e.preventDefault(); comp.current = c; setText(c.text);
        requestAnimationFrame(() => input.current?.setSelectionRange(c.caret, c.caret));
      }
      return;
    }
    comp.current = null;
    if (e.key === 'ArrowUp' && history.current.length) { pos.current = Math.min(pos.current + 1, history.current.length - 1); setText(history.current[pos.current]!); e.preventDefault(); }
    if (e.key === 'ArrowDown' && pos.current >= 0) { pos.current -= 1; setText(pos.current >= 0 ? history.current[pos.current]! : ''); e.preventDefault(); }
  };
  const label = target && target.kind !== 'server' ? t('chat.messageTo', { name: target.name }) : t('chat.command');
  return (
    <form className="chat-compose" onSubmit={submit}>
      <label htmlFor="chat-input" className="sr-only">{label}</label>
      <input id="chat-input" ref={input} value={text} onPaste={onPaste} onChange={(e) => { setText(e.target.value); if (e.target.value && !e.target.value.startsWith('/')) typing(); else if (!e.target.value) doneTyping(); }} onKeyDown={keys} placeholder={label} maxLength={400} autoComplete="off" spellCheck />
      <button className="btn btn-primary" type="submit">{t('chat.send')}</button>
    </form>
  );
}

function JoinBox() {
  const t = useT();
  const join = useChat((s) => s.join);
  const [name, setName] = useState('');
  const q = useQuery({ queryKey: ['irc', 'channels'], queryFn: () => api.get<{ channels: ChannelInfo[] }>('/irc/channels'), refetchInterval: 60_000 });
  const joined = useChat((s) => s.buffers);
  const more = (q.data?.channels ?? []).filter((c) => !joined.get(c.name)?.joined);
  return (
    <div className="chat-join">
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { join(name); setName(''); } }}>
        <label htmlFor="chat-join">{t('chat.join')}</label>
        <div className="row"><input id="chat-join" value={name} onChange={(e) => setName(e.target.value)} placeholder="#channel" autoComplete="off" /><button className="btn" type="submit">{t('chat.joinButton')}</button></div>
      </form>
      {q.isError && <p className="hint">{errorText(q.error)}</p>}
      {more.length > 0 && (
        <>
          <h2 className="chat-more">{t('chat.siteChannels')}</h2>
          <ul className="plain">
            {more.map((c) => (
              <li key={c.name}>
                <button type="button" className="link" onClick={() => join(c.name)}>{c.name}</button>
                <span className="hint"> {c.ring ? t('chat.kind.ring', { name: c.ring.name }) : c.kind === 'user' ? t('chat.kind.user', { name: c.owner ?? '' }) : t('chat.kind.official')}{c.users ? ` · ${t('chat.usersHere', { count: c.users })}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
