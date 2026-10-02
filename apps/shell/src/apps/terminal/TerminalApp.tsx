import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { api, ApiError } from '../../api';
import { readPrefs, usePrefs } from '../../devicePrefs';
import { Alert } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { errorText, useSite, useT } from '../../hooks';
import { useSubtitle } from '../../nav';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { backoffMs, wasDropped } from '../../reconnect';
import { playChime } from '../../alerts';
import { terminalPalette, ANSI_NAMES } from '@app/ui-themes';
import { terminalScheme } from '../../theme';
import type { StringKey } from '@app/strings';

// xterm's colours from the screen colour (docs/10): the BBS looks like your Terminal theme wherever it opens.
function xtermTheme(): ITheme {
  const p = terminalPalette(terminalScheme());
  const theme: Record<string, string> = { background: p.background, foreground: p.foreground, cursor: p.cursor, cursorAccent: p.background, selectionBackground: p.selection };
  ANSI_NAMES.forEach((name, i) => {
    theme[name] = p.colours[i]!;
    theme[`bright${name[0]!.toUpperCase()}${name.slice(1)}`] = p.colours[i + 8]!;
  });
  return theme as ITheme;
}

type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

// Keys a phone keyboard doesn't have (docs/10), sent as the bytes a terminal would. Ctrl and Alt hold for the next key.
const KEYS: { label: string; seq: string; name: StringKey }[] = [
  { label: 'Esc', seq: '\x1b', name: 'terminal.key.esc' },
  { label: 'Tab', seq: '\t', name: 'terminal.key.tab' },
  { label: '←', seq: '\x1b[D', name: 'terminal.key.left' },
  { label: '↑', seq: '\x1b[A', name: 'terminal.key.up' },
  { label: '↓', seq: '\x1b[B', name: 'terminal.key.down' },
  { label: '→', seq: '\x1b[C', name: 'terminal.key.right' },
  { label: 'Home', seq: '\x1b[H', name: 'terminal.key.home' },
  { label: 'End', seq: '\x1b[F', name: 'terminal.key.end' },
  { label: 'PgUp', seq: '\x1b[5~', name: 'terminal.key.pgup' },
  { label: 'PgDn', seq: '\x1b[6~', name: 'terminal.key.pgdn' },
  { label: 'Enter', seq: '\r', name: 'terminal.key.enter' },
];
const FKEYS = ['\x1bOP', '\x1bOQ', '\x1bOR', '\x1bOS', '\x1b[15~', '\x1b[17~', '\x1b[18~', '\x1b[19~', '\x1b[20~', '\x1b[21~'];

// What a key does with Ctrl or Alt held from the on-screen row: Ctrl+letter is the control byte, Alt is Escape first.
export function withModifiers(d: string, mods: { ctrl: boolean; alt: boolean }): string {
  let out = d;
  if (mods.ctrl && out.length === 1) {
    const c = out.toUpperCase().charCodeAt(0);
    if (c >= 64 && c <= 95) out = String.fromCharCode(c - 64);
    else if (out === ' ') out = '\x00';
  }
  return mods.alt ? `\x1b${out}` : out;
}

// The BBS in a window (docs/04, 10): xterm.js over a WebSocket, signed in with a one-use ticket so there is
// no prompt. The BBS sends UTF-8 text; the window sends keystrokes and its size.
export default function TerminalApp() {
  const t = useT();
  const toast = useToast();
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const refit = useRef<(() => void) | null>(null);
  const [prefs, setPrefs] = usePrefs('terminal');
  const [help, setHelp] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [mods, setMods] = useState({ ctrl: false, alt: false });
  const [flash, setFlash] = useState(false);
  const modsRef = useRef(mods);
  modsRef.current = mods;
  useSubtitle(title);

  const send = useCallback((m: object) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m)); }, []);
  const type = useCallback((d: string) => {
    const m = modsRef.current;
    send({ t: 'in', d: m.ctrl || m.alt ? withModifiers(d, m) : d });
    if (m.ctrl || m.alt) setMods({ ctrl: false, alt: false });
  }, [send]);

  const copy = useCallback(async () => {
    const text = term.current?.getSelection() ?? '';
    if (!text) { toast(t('terminal.nothingSelected')); return; }
    try { await navigator.clipboard.writeText(text); toast(t('common.copied')); } catch { toast(t('terminal.clipboardBlocked')); }
  }, [t, toast]);
  const paste = useCallback(async () => {
    try { const text = await navigator.clipboard.readText(); if (text) send({ t: 'in', d: text.replace(/\r?\n/g, '\r') }); } catch { toast(t('terminal.clipboardBlocked')); }
    term.current?.focus();
  }, [send, t, toast]);

  const attempt = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout>>();
  const connectRef = useRef<() => Promise<void>>(async () => undefined);
  const retryLater = useCallback(() => {
    setStatus('reconnecting');
    clearTimeout(retry.current);
    retry.current = setTimeout(() => void connectRef.current(), backoffMs(attempt.current++));
  }, []);

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
      sock.onopen = () => { attempt.current = 0; setStatus('connected'); sock.send(JSON.stringify({ t: 'hello', handle: nick, ticket, cols: x.cols, rows: x.rows })); x.focus(); };
      sock.onmessage = (e) => { if (typeof e.data === 'string') x.write(e.data); };
      sock.onclose = (ev) => {
        if (ws.current !== sock) return;
        // A lost connection comes back by itself; a goodbye (or the BBS hanging up) stays closed.
        if (wasDropped(ev.code)) { x.write(`\r\n\x1b[2m-- ${t('terminal.dropped')} --\x1b[0m\r\n`); retryLater(); } else { setStatus('closed'); setTitle(null); }
      };
      sock.onerror = () => { setError(t('terminal.failed')); };
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return retryLater(); // no network: keep trying
      setStatus('error');
      setError(errorText(e));
    }
  }, [t, retryLater]);

  connectRef.current = connect;

  useEffect(() => {
    const p = readPrefs('terminal');
    const x = new Terminal({
      convertEol: false, cursorBlink: true, allowProposedApi: true, theme: xtermTheme(), fontSize: p.fontSize, scrollback: p.scrollback, screenReaderMode: p.reader,
      fontFamily: '"Px437 IBM VGA 8x16", "Web437 IBM VGA 8x16", "IBM Plex Mono", ui-monospace, monospace',
    });
    const fit = new FitAddon();
    const finder = new SearchAddon();
    const unicode = new Unicode11Addon();
    x.loadAddon(fit);
    x.loadAddon(finder);
    x.loadAddon(unicode);
    x.unicode.activeVersion = '11'; // box drawing and emoji take the width the BBS expects
    // Links open in a new tab, never with access back to this page.
    x.loadAddon(new WebLinksAddon((_e, uri) => { if (/^https?:\/\//i.test(uri)) window.open(uri, '_blank', 'noopener,noreferrer'); }));
    x.open(host.current!);
    term.current = x;
    search.current = finder;
    const doFit = () => { try { fit.fit(); send({ t: 'size', cols: x.cols, rows: x.rows }); } catch { /* not visible yet */ } };
    doFit();
    refit.current = doFit;
    // Copy and paste like a desktop terminal: Ctrl+Shift+C and V, and Ctrl+C copies when something is selected.
    x.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'c') { void copy(); return false; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'v') { void paste(); return false; }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'f') { setFinding(true); return false; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === 'c' && x.hasSelection()) { void copy(); x.clearSelection(); return false; }
      return true;
    });
    const data = x.onData((d) => type(d));
    const sel = x.onSelectionChange(() => {
      if (readPrefs('terminal').copyOnSelect && x.hasSelection()) void navigator.clipboard.writeText(x.getSelection()).catch(() => undefined);
    });
    const bell = x.onBell(() => {
      const how = readPrefs('terminal').bell;
      if (how === 'sound') playChime();
      else if (how === 'flash') { setFlash(true); setTimeout(() => setFlash(false), 180); }
    });
    const titled = x.onTitleChange((s) => setTitle(s.trim().slice(0, 80) || null));
    const ro = new ResizeObserver(doFit);
    ro.observe(host.current!);
    // A small message now and then keeps proxies from closing a quiet connection.
    const keepalive = setInterval(() => send({ t: 'ping' }), 30_000);
    void connect();
    return () => {
      clearTimeout(retry.current); clearInterval(keepalive); ro.disconnect(); data.dispose(); sel.dispose(); bell.dispose(); titled.dispose();
      const sock = ws.current; ws.current = null; sock?.close(); x.dispose(); term.current = null; refit.current = null;
    };
  }, [connect, send, type, copy, paste]);

  useEffect(() => { if (term.current) term.current.options.screenReaderMode = prefs.reader; }, [prefs.reader]);
  useEffect(() => { if (term.current) term.current.options.scrollback = prefs.scrollback; }, [prefs.scrollback]);
  // Follow a new screen colour picked in Settings while the window is open.
  const [screenBg, setScreenBg] = useState(() => terminalPalette(terminalScheme()).background);
  useEffect(() => {
    const onTheme = () => { const th = xtermTheme(); setScreenBg(th.background!); if (term.current) term.current.options.theme = th; };
    window.addEventListener('ui:theme', onTheme);
    return () => window.removeEventListener('ui:theme', onTheme);
  }, []);
  // A new text size is applied at once and the screen is re-fitted, so the BBS gets the new column count.
  useEffect(() => {
    const x = term.current;
    if (!x || x.options.fontSize === prefs.fontSize) return;
    x.options.fontSize = prefs.fontSize;
    refit.current?.();
  }, [prefs.fontSize]);

  const find = (back = false) => {
    if (!query) return;
    const opts = { caseSensitive: false, decorations: { matchOverviewRuler: '#888', activeMatchColorOverviewRuler: '#fff', matchBackground: '#665500', activeMatchBackground: '#aa8800' } };
    const ok = back ? search.current?.findPrevious(query, opts) : search.current?.findNext(query, opts);
    if (!ok) toast(t('terminal.notFound'));
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.current?.requestFullscreen?.().catch(() => undefined);
    term.current?.focus();
  };

  return (
    <div className="app-content terminal-app app-fill" ref={frame}>
      {error && <Alert kind="error">{error}</Alert>}
      {status === 'connecting' && <p className="hint" role="status">{t('terminal.connecting')}</p>}
      {status === 'reconnecting' && <p className="hint" role="status">{t('terminal.reconnecting')}</p>}
      {status === 'closed' && <Alert kind="info">{t('terminal.closed')} <button type="button" className="link" onClick={() => void connect()}>{t('terminal.reconnect')}</button></Alert>}
      <div className="toolbar terminal-tools" role="toolbar" aria-label={t('terminal.tools')}>
        <button type="button" className="btn btn-small" onClick={() => void copy()} aria-keyshortcuts="Control+Shift+C">{t('terminal.copy')}</button>
        <button type="button" className="btn btn-small" onClick={() => void paste()} aria-keyshortcuts="Control+Shift+V">{t('terminal.paste')}</button>
        <button type="button" className="btn btn-small" aria-pressed={finding} onClick={() => setFinding(!finding)} aria-keyshortcuts="Control+Shift+F">{t('terminal.find')}</button>
        <span className="spacer" />
        <button type="button" className="btn btn-small" onClick={fullscreen}>{t('terminal.fullscreen')}</button>
      </div>
      {finding && (
        <form className="row terminal-find" role="search" onSubmit={(e) => { e.preventDefault(); find(); }}>
          <label htmlFor="term-find" className="sr-only">{t('terminal.findLabel')}</label>
          <input id="term-find" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('terminal.findLabel')}
            onKeyDown={(e) => { if (e.key === 'Escape') { setFinding(false); search.current?.clearDecorations(); term.current?.focus(); } }} />
          <button type="button" className="btn btn-small" onClick={() => find(true)}>{t('terminal.findPrev')}</button>
          <button type="submit" className="btn btn-small">{t('terminal.findNext')}</button>
        </form>
      )}
      <div className={`terminal-screen${flash ? ' is-bell' : ''}`} ref={host} aria-label={t('terminal.screen')} style={{ background: screenBg }} />
      <div className="terminal-keys" role="group" aria-label={t('terminal.keys')}>
        <button type="button" className="btn btn-quiet" aria-pressed={mods.ctrl} onClick={() => { setMods({ ...mods, ctrl: !mods.ctrl }); term.current?.focus(); }}>Ctrl</button>
        <button type="button" className="btn btn-quiet" aria-pressed={mods.alt} onClick={() => { setMods({ ...mods, alt: !mods.alt }); term.current?.focus(); }}>Alt</button>
        {KEYS.map((k) => (
          <button key={k.label} type="button" className="btn btn-quiet" aria-label={t(k.name)} onClick={() => { type(k.seq); term.current?.focus(); }}>{k.label}</button>
        ))}
        <details className="terminal-fkeys">
          <summary className="btn btn-quiet">{t('terminal.fkeys')}</summary>
          {FKEYS.map((seq, i) => <button key={seq} type="button" className="btn btn-quiet" onClick={() => { send({ t: 'in', d: seq }); term.current?.focus(); }}>F{i + 1}</button>)}
        </details>
      </div>
      <label className="check switch"><input type="checkbox" role="switch" checked={prefs.reader} onChange={(e) => setPrefs({ reader: e.target.checked })} /><span>{t('terminal.reader')}</span></label>
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
