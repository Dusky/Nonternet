import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, useSite, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { parseFormatting, type Segment } from './format';
import { sortedUsers, useChat, type Buffer, type Msg } from './store';

interface ChannelInfo { name: string; kind: 'official' | 'ring' | 'user'; owner: string | null; ring: { slug: string; name: string } | null; users: number | null; topic: string | null }

export default function ChatApp() {
  const t = useT();
  const { status, error, connect, disconnect } = useChat();
  useEffect(() => { connect(); return () => disconnect(); }, [connect, disconnect]);
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="app-content chat">
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
                  {b.unread > 0 && !isMuted && <span className="badge">{b.mentioned ? t('chat.mention', { count: b.unread }) : t('chat.unread', { count: b.unread })}</span>}
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
          <ul className="plain">{sortedUsers(buf).map(([nick, prefix]) => <li key={nick}><span className="chat-prefix" aria-label={prefix ? t(`chat.prefix.${PREFIX_NAME[prefix] ?? 'op'}` as never) : undefined}>{prefix}</span>{nick}</li>)}</ul>
        </aside>
      )}
    </div>
  );
}
const PREFIX_NAME: Record<string, string> = { '~': 'owner', '&': 'admin', '@': 'op', '%': 'halfop', '+': 'voice' };

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
  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [buf.messages, buf.name]);
  const t = useT();
  return (
    // A log region is announced politely by screen readers as lines arrive. It scrolls, so it can take focus.
    <div ref={ref} className="chat-log" role="log" aria-live="polite" aria-label={t('chat.messages', { name: buf.kind === 'server' ? t('chat.server') : buf.name })} tabIndex={0}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      <ol className="plain">{buf.messages.map((m) => <Line key={m.id} m={m} />)}</ol>
    </div>
  );
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Line({ m }: { m: Msg }) {
  const t = useT();
  const cls = `chat-line chat-k-${m.kind}${m.mention ? ' is-mention' : ''}${m.self ? ' is-self' : ''}`;
  const when = <time className="chat-time" dateTime={new Date(m.time).toISOString()}>{time(m.time)}</time>;
  switch (m.kind) {
    case 'message': return <li className={cls}>{when} <span className="chat-nick">{m.nick}</span> <IrcText text={m.text} /></li>;
    case 'action': return <li className={cls}>{when} <span aria-hidden="true">* </span><span className="chat-nick">{m.nick}</span> <IrcText text={m.text} /></li>;
    case 'notice': return <li className={cls}>{when} <span className="chat-nick">-{m.nick || t('chat.server')}-</span> <IrcText text={m.text} /></li>;
    case 'info': case 'error': return <li className={cls}>{when} {m.key ? t(m.key) : <IrcText text={m.text} />}</li>;
    default: return <li className={cls}>{when} {t(`chat.event.${m.kind}` as never, { nick: m.nick, text: m.text })}</li>;
  }
}

export function IrcText({ text }: { text: string }) {
  return <>{parseFormatting(text).map((s, i) => <Seg key={i} s={s} />)}</>;
}
function Seg({ s }: { s: Segment }) {
  const cls = [s.bold && 'irc-b', s.italic && 'irc-i', s.underline && 'irc-u', s.strike && 'irc-s', s.mono && 'irc-m', s.fg !== undefined && `irc-c${s.fg}`].filter(Boolean).join(' ');
  if (s.link) return <a className={cls || undefined} href={s.link} target="_blank" rel="noopener noreferrer nofollow ugc">{s.text}</a>;
  return cls ? <span className={cls}>{s.text}</span> : <>{s.text}</>;
}

function Composer({ target }: { target: Buffer | undefined }) {
  const t = useT();
  const send = useChat((s) => s.send);
  const [text, setText] = useState('');
  const history = useRef<string[]>([]);
  const pos = useRef(-1);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!text.trim()) return; send(text); history.current.unshift(text); pos.current = -1; setText(''); };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && history.current.length) { pos.current = Math.min(pos.current + 1, history.current.length - 1); setText(history.current[pos.current]!); e.preventDefault(); }
    if (e.key === 'ArrowDown' && pos.current >= 0) { pos.current -= 1; setText(pos.current >= 0 ? history.current[pos.current]! : ''); e.preventDefault(); }
  };
  const label = target && target.kind !== 'server' ? t('chat.messageTo', { name: target.name }) : t('chat.command');
  return (
    <form className="chat-compose" onSubmit={submit}>
      <label htmlFor="chat-input" className="sr-only">{label}</label>
      <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} placeholder={label} maxLength={400} autoComplete="off" spellCheck />
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
