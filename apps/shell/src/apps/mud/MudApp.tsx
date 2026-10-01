import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Alert } from '../../components/ui';
import { useSite, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { parseMarkup, type MudSeg } from './markup';
import { useMud, type Line } from './store';

export default function MudApp() {
  const t = useT();
  const { status, error, connect, disconnect } = useMud();
  useEffect(() => { connect(); return () => disconnect(); }, [connect, disconnect]);
  const [help, setHelp] = useState(false);
  return (
    <div className="app-content mud">
      {status === 'error' && <Alert kind="error">{error ?? t('mud.failed')}</Alert>}
      {status === 'closed' && <Alert kind="info">{t('mud.closed')} <button type="button" className="link" onClick={() => { disconnect(); connect(); }}>{t('mud.reconnect')}</button></Alert>}
      {status === 'connecting' && <p className="hint" role="status">{t('mud.connecting')}</p>}
      {status === 'reconnecting' && <p className="hint" role="status">{t('mud.reconnecting')}</p>}
      {status !== 'error' && <Screen />}
      <p className="hint">{t('mud.tips')}</p>
      <button type="button" className="link" aria-expanded={help} onClick={() => setHelp(!help)}>{t('mud.nativeTitle')}</button>
      {help && <NativeHelp />}
    </div>
  );
}

function NativeHelp() {
  const t = useT();
  const site = useSite();
  return (
    <div className="panel">
      <p>{t('mud.native', { host: site.mud.host, port: site.mud.port })}</p>
      <p><OpenAppLink app="settings" to="terminal">{t('chat.nativeSettings')}</OpenAppLink></p>
    </div>
  );
}

function Screen() {
  const t = useT();
  const { lines, status, send } = useMud();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lines]);
  return (
    <section className="mud-screen" aria-label={t('app.mud')}>
      <div ref={ref} className="mud-log" role="log" aria-live="polite" aria-label={t('mud.log')} tabIndex={0}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {lines.map((l) => <Block key={l.id} line={l} />)}
      </div>
      <Command disabled={status !== 'playing'} onSend={send} />
    </section>
  );
}

function Block({ line }: { line: Line }) {
  const t = useT();
  if (line.kind === 'note') return <p className="mud-note">{line.key ? t(line.key) : line.text}</p>;
  if (line.kind === 'you') return <p className="mud-you"><span aria-hidden="true">&gt; </span>{line.text}</p>;
  return <div className="mud-out">{parseMarkup(line.text).map((segs, i) => <p key={i}>{segs.length ? segs.map((s, j) => <Seg key={j} s={s} />) : ' '}</p>)}</div>;
}

function Seg({ s }: { s: MudSeg }) {
  const cls = [s.fg && `mud-${s.fg}${s.bright ? '-b' : ''}`, s.underline && 'mud-u'].filter(Boolean).join(' ');
  // xterm-256 colours: pulled toward the theme's text colour so they stay readable (as the Chat app does).
  const style = s.rgb ? { color: `color-mix(in srgb, rgb(${s.rgb.map((v) => v * 51).join(' ')}) 60%, var(--text))` } : undefined;
  return cls || style ? <span className={cls || undefined} style={style}>{s.text}</span> : <>{s.text}</>;
}

function Command({ disabled, onSend }: { disabled: boolean; onSend: (t: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const history = useRef<string[]>([]);
  const pos = useRef(-1);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!text.trim()) return; onSend(text); history.current.unshift(text); pos.current = -1; setText(''); };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && history.current.length) { pos.current = Math.min(pos.current + 1, history.current.length - 1); setText(history.current[pos.current]!); e.preventDefault(); }
    if (e.key === 'ArrowDown' && pos.current >= 0) { pos.current -= 1; setText(pos.current >= 0 ? history.current[pos.current]! : ''); e.preventDefault(); }
  };
  return (
    <form className="chat-compose" onSubmit={submit}>
      <label htmlFor="mud-input" className="sr-only">{t('mud.command')}</label>
      <input id="mud-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} placeholder={t('mud.command')} disabled={disabled}
        maxLength={500} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      <button className="btn btn-primary" type="submit" disabled={disabled}>{t('mud.send')}</button>
    </form>
  );
}
