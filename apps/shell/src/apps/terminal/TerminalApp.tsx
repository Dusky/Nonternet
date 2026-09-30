import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, useSite, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';

type Status = 'connecting' | 'connected' | 'closed' | 'error';

// Keys a phone keyboard doesn't have (docs/10), sent as the bytes a terminal would.
const KEYS: { label: string; seq: string; name: string }[] = [
  { label: 'Esc', seq: '\x1b', name: 'terminal.key.esc' },
  { label: 'Tab', seq: '\t', name: 'terminal.key.tab' },
  { label: 'Ctrl-C', seq: '\x03', name: 'terminal.key.ctrlc' },
  { label: '←', seq: '\x1b[D', name: 'terminal.key.left' },
  { label: '↑', seq: '\x1b[A', name: 'terminal.key.up' },
  { label: '↓', seq: '\x1b[B', name: 'terminal.key.down' },
  { label: '→', seq: '\x1b[C', name: 'terminal.key.right' },
  { label: 'Enter', seq: '\r', name: 'terminal.key.enter' },
];

// The BBS in a window (docs/04, 10): xterm.js over a WebSocket, signed in with a one-use ticket so there is
// no prompt. The BBS sends UTF-8 text; the window sends keystrokes and its size.
export default function TerminalApp() {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [reader, setReader] = useState(false);
  const [help, setHelp] = useState(false);

  const send = useCallback((m: object) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m)); }, []);

  const connect = useCallback(async () => {
    const x = term.current;
    if (!x) return;
    setStatus('connecting');
    setError(null);
    try {
      const { ticket, nick } = await api.post<{ ticket: string; nick: string }>('/bbs/ticket');
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/bbs`;
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => { setStatus('connected'); sock.send(JSON.stringify({ t: 'hello', handle: nick, ticket, cols: x.cols, rows: x.rows })); x.focus(); };
      sock.onmessage = (e) => x.write(typeof e.data === 'string' ? e.data : '');
      sock.onclose = () => { if (ws.current === sock) setStatus('closed'); };
      sock.onerror = () => setError(t('terminal.failed'));
    } catch (e) {
      setStatus('error');
      setError(errorText(e));
    }
  }, [t]);

  useEffect(() => {
    const x = new Terminal({ convertEol: false, cursorBlink: true, fontFamily: '"Px437 IBM VGA 8x16", "Web437 IBM VGA 8x16", ui-monospace, monospace', fontSize: 16, scrollback: 2000, allowProposedApi: false });
    const fit = new FitAddon();
    x.loadAddon(fit);
    x.open(host.current!);
    term.current = x;
    const doFit = () => { try { fit.fit(); send({ t: 'size', cols: x.cols, rows: x.rows }); } catch { /* not visible yet */ } };
    doFit();
    const data = x.onData((d) => send({ t: 'in', d }));
    const ro = new ResizeObserver(doFit);
    ro.observe(host.current!);
    void connect();
    return () => { ro.disconnect(); data.dispose(); ws.current?.close(); ws.current = null; x.dispose(); term.current = null; };
  }, [connect, send]);

  useEffect(() => { if (term.current) term.current.options.screenReaderMode = reader; }, [reader]);

  return (
    <div className="app-content terminal-app">
      {error && <Alert kind="error">{error}</Alert>}
      {status === 'connecting' && <p className="hint" role="status">{t('terminal.connecting')}</p>}
      {status === 'closed' && <Alert kind="info">{t('terminal.closed')} <button type="button" className="link" onClick={() => void connect()}>{t('terminal.reconnect')}</button></Alert>}
      <div className="terminal-screen" ref={host} aria-label={t('terminal.screen')} />
      <div className="terminal-keys" role="group" aria-label={t('terminal.keys')}>
        {KEYS.map((k) => (
          <button key={k.label} type="button" className="btn btn-quiet" aria-label={t(k.name as never)} onClick={() => { send({ t: 'in', d: k.seq }); term.current?.focus(); }}>{k.label}</button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={reader} onChange={(e) => setReader(e.target.checked)} /> {t('terminal.reader')}</label>
      <button type="button" className="link" aria-expanded={help} onClick={() => setHelp(!help)}>{t('terminal.nativeTitle')}</button>
      {help && <NativeHelp />}
    </div>
  );
}

function NativeHelp() {
  const t = useT();
  const site = useSite();
  return (
    <div className="panel">
      <p>{t('terminal.native', { host: site.bbs.host, telnet: site.bbs.telnet_port, ssh: site.bbs.ssh_port })}</p>
      <p><code>telnet {site.bbs.host} {site.bbs.telnet_port}</code></p>
      <p><code>ssh -p {site.bbs.ssh_port} yourhandle@{site.bbs.host}</code></p>
      <p><OpenAppLink app="settings" to="terminal">{t('terminal.nativeSettings')}</OpenAppLink></p>
    </div>
  );
}
