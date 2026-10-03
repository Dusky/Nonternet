import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Alert, Loading } from '../../components/ui';
import { useSite, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { keyName, NUMPAD, type Highlight } from './engine';
import { parseMarkup, plainText, type MudSeg } from './markup';
import { useMud, type CaptureLine, type Line, type MapRoom } from './store';
import { downloadLog } from './log';

const ClientEditor = lazy(() => import('./ClientEditor'));

export default function MudApp() {
  const t = useT();
  const { status, error, connect, disconnect, settings } = useMud();
  useEffect(() => { connect(); return () => disconnect(); }, [connect, disconnect]);
  const [help, setHelp] = useState(false);
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [panel, setPanel] = useState(true);
  const showPanel = settings.options.panel && panel;
  return (
    <div className="app-content mud app-fill">
      {status === 'error' && <Alert kind="error">{error ?? t('mud.failed')}</Alert>}
      {status === 'closed' && <Alert kind="info">{t('mud.closed')} <button type="button" className="link" onClick={() => { disconnect(); connect(); }}>{t('mud.reconnect')}</button></Alert>}
      {status === 'connecting' && <p className="hint" role="status">{t('mud.connecting')}</p>}
      {status === 'reconnecting' && <p className="hint" role="status">{t('mud.reconnecting')}</p>}
      <div className="toolbar mud-toolbar" role="toolbar" aria-label={t('mud.toolbar')}>
        <button type="button" className="btn btn-quiet" aria-pressed={finding} onClick={() => setFinding(!finding)}>{t('mud.find')}</button>
        <SaveLog />
        <button type="button" className="btn btn-quiet" onClick={() => useMud.getState().clear()}>{t('mud.clear')}</button>
        {settings.options.panel && <button type="button" className="btn btn-quiet" aria-pressed={panel} onClick={() => setPanel(!panel)}>{t('mud.panel')}</button>}
        <button type="button" className="btn btn-quiet" aria-expanded={editing} onClick={() => setEditing(!editing)}>{t('mud.rules')}</button>
      </div>
      {editing && <Suspense fallback={<Loading />}><ClientEditor onClose={() => setEditing(false)} /></Suspense>}
      {status !== 'error' && (
        <div className={`mud-layout${showPanel ? ' has-panel' : ''}`}>
          <Screen finding={finding} onCloseFind={() => setFinding(false)} />
          {showPanel && <Side />}
        </div>
      )}
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
      <p>{t('mud.nativeGmcp')}</p>
      <p><OpenAppLink app="settings" to="terminal">{t('chat.nativeSettings')}</OpenAppLink></p>
    </div>
  );
}

function SaveLog() {
  const t = useT();
  const note = (l: Line) => (l.key ? t(l.key) : l.text);
  return (
    <details className="menu-details">
      <summary className="btn btn-quiet">{t('mud.saveLog')}</summary>
      <div className="menu-pop">
        <button type="button" className="btn btn-quiet" onClick={() => downloadLog(useMud.getState().lines, 'txt', note)}>{t('mud.saveText')}</button>
        <button type="button" className="btn btn-quiet" onClick={() => downloadLog(useMud.getState().lines, 'html', note)}>{t('mud.saveHtml')}</button>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- the log

function Screen({ finding, onCloseFind }: { finding: boolean; onCloseFind: () => void }) {
  const t = useT();
  const { lines, status, settings } = useMud();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [query, setQuery] = useState('');
  const [hit, setHit] = useState(0);
  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lines]);
  const q = finding ? query.trim().toLowerCase() : '';
  const hits = useMemo(() => (q ? lines.filter((l) => (l.kind === 'game' ? plainText(l.text) : l.text).toLowerCase().includes(q)).map((l) => l.id) : []), [lines, q]);
  const jump = (dir: 1 | -1) => {
    if (!hits.length) return;
    const next = (hit + dir + hits.length) % hits.length;
    setHit(next);
    ref.current?.querySelector(`[data-line="${hits[next]}"]`)?.scrollIntoView({ block: 'center' });
  };
  const toBottom = () => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setScrolledUp(false); } };
  return (
    <section className="mud-screen" aria-label={t('app.mud')} style={{ ['--mud-font' as string]: `${settings.options.fontSize}px` }}>
      {finding && (
        <div className="mud-find" role="search">
          <label htmlFor="mud-find" className="sr-only">{t('mud.findLabel')}</label>
          <input id="mud-find" type="search" value={query} autoFocus placeholder={t('mud.findLabel')}
            onChange={(e) => { setQuery(e.target.value); setHit(0); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); jump(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') onCloseFind(); }} />
          <span className="hint" role="status">{q ? t('mud.findCount', { count: hits.length }) : ''}</span>
          <button type="button" className="btn btn-quiet" onClick={() => jump(-1)} disabled={!hits.length}>{t('terminal.findPrev')}</button>
          <button type="button" className="btn btn-quiet" onClick={() => jump(1)} disabled={!hits.length}>{t('terminal.findNext')}</button>
        </div>
      )}
      <div ref={ref} className="mud-log" role="log" aria-live="polite" aria-label={t('mud.log')} tabIndex={0}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; setScrolledUp(!stick.current); }}>
        {lines.map((l) => <Block key={l.id} line={l} mark={q} current={hits[hit] === l.id} />)}
      </div>
      {/* Scrolled back to read: the newest lines stay in view below, like a split screen. */}
      {scrolledUp && (
        <div className="mud-split" aria-hidden="true">
          {lines.slice(-6).map((l) => <Block key={l.id} line={l} mark="" current={false} />)}
          <button type="button" className="btn btn-quiet mud-latest" tabIndex={-1} onClick={toBottom}>{t('chat.jump')}</button>
        </div>
      )}
      <Buttons />
      <Command disabled={status !== 'playing'} />
    </section>
  );
}

function Block({ line, mark, current }: { line: Line; mark: string; current: boolean }) {
  const t = useT();
  const cls = current ? ' is-hit' : '';
  if (line.kind === 'note') return <p className={`mud-note${cls}`} data-line={line.id}>{line.key ? t(line.key) : line.text}</p>;
  if (line.kind === 'you') return <p className={`mud-you${cls}`} data-line={line.id}><span aria-hidden="true">&gt; </span><Marked text={line.text} mark={mark} /></p>;
  const parsed = parseMarkup(line.text);
  if (line.gagged && line.gagged.length >= parsed.filter((l) => l.length).length) return null;
  return (
    <div className={`mud-out${cls}`} data-line={line.id}>
      {parsed.map((segs, i) => (line.gagged?.includes(i) ? null : (
        <p key={i}>{segs.length ? <Segs segs={segs} highlights={line.highlights?.[i]} mark={mark} /> : ' '}</p>
      )))}
    </div>
  );
}

// Text with the search term marked.
function Marked({ text, mark }: { text: string; mark: string }) {
  if (!mark) return <>{text}</>;
  const parts: ReactNode[] = [];
  const low = text.toLowerCase();
  let at = 0;
  for (let i = low.indexOf(mark); i >= 0; i = low.indexOf(mark, i + mark.length)) {
    parts.push(text.slice(at, i), <mark key={i}>{text.slice(i, i + mark.length)}</mark>);
    at = i + mark.length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

// One line's segments, with trigger highlights laid over the character ranges they cover.
function Segs({ segs, highlights, mark }: { segs: MudSeg[]; highlights?: Highlight[]; mark: string }) {
  const whole = highlights?.find((h) => h.end === -1);
  let pos = 0;
  const out: ReactNode[] = [];
  segs.forEach((s, i) => {
    const start = pos;
    pos += s.text.length;
    const parts = highlights && !whole ? cut(s.text, start, highlights.filter((h) => h.end !== -1)) : [{ text: s.text, colour: undefined as string | undefined }];
    parts.forEach((p, j) => out.push(<Seg key={`${i}.${j}`} s={{ ...s, text: p.text }} hl={p.colour} mark={mark} />));
  });
  return whole ? <span className={`mud-hl mud-hl-${whole.colour}`}>{out}</span> : <>{out}</>;
}

function cut(text: string, offset: number, hs: Highlight[]): { text: string; colour?: string }[] {
  const out: { text: string; colour?: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const abs = offset + i;
    const h = hs.find((x) => abs >= x.start && abs < x.end);
    const nextEdge = Math.min(...hs.flatMap((x) => [x.start, x.end]).filter((e) => e > abs).map((e) => e - offset), text.length);
    out.push({ text: text.slice(i, nextEdge), colour: h?.colour });
    i = nextEdge;
  }
  return out;
}

const ANSI_HEX: Record<string, string> = { red: '#e02020', green: '#10a010', yellow: '#c8a000', blue: '#2050ff', magenta: '#c020c0', cyan: '#00a0a0', white: '#e0e0e0', black: '#202020', grey: '#808080' };
const cube = (rgb: [number, number, number]) => `rgb(${rgb.map((v) => (v ? 55 + v * 40 : 0)).join(' ')})`;

function Seg({ s, hl, mark }: { s: MudSeg; hl?: string; mark: string }) {
  const sendRaw = useMud((x) => x.sendRaw);
  const cls = [s.fg && `mud-${s.fg}${s.bright ? '-b' : ''}`, s.underline && 'mud-u', s.italic && 'mud-i', s.inverse && 'mud-inv', hl && `mud-hl mud-hl-${hl}`].filter(Boolean).join(' ');
  // Colours from the game are pulled toward the theme's own, so they stay readable in every theme (as the Chat app does).
  const style: CSSProperties = {};
  if (s.rgb) style.color = `color-mix(in srgb, ${cube(s.rgb)} 60%, var(--text))`;
  if (s.grey !== undefined) style.color = `color-mix(in srgb, var(--text) ${Math.round(45 + (s.grey / 25) * 55)}%, var(--muted))`;
  const bg = s.bgRgb ? cube(s.bgRgb) : s.bg ? ANSI_HEX[s.bg] : undefined;
  if (bg) style.backgroundColor = `color-mix(in srgb, ${bg} 28%, var(--surface))`;
  const body = <Marked text={s.text} mark={mark} />;
  if (s.link) return <button type="button" className={`link mud-link ${cls}`} style={style} title={s.link} onClick={() => sendRaw(s.link!)}>{body}</button>;
  return cls || Object.keys(style).length ? <span className={cls || undefined} style={style}>{body}</span> : body;
}

// ---------------------------------------------------------------- input

function Buttons() {
  const { settings, send } = useMud();
  if (!settings.buttons.length) return null;
  return (
    <div className="mud-buttons" role="group" aria-label={useT()('mud.buttons')}>
      {settings.buttons.map((b) => <button key={b.id} type="button" className="btn" onClick={() => send(b.send)}>{b.label}</button>)}
    </div>
  );
}

function Command({ disabled }: { disabled: boolean }) {
  const t = useT();
  const { send, remember, settings } = useMud();
  const [text, setText] = useState('');
  const pos = useRef(-1);
  const draft = useRef('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text); remember(text); pos.current = -1; setText('');
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    const name = keyName(e);
    const rule = name ? settings.keys.find((k) => k.enabled && k.key === name) : undefined;
    if (rule) { e.preventDefault(); send(rule.send); return; }
    if (name && settings.options.numpad && NUMPAD[name] && !disabled) { e.preventDefault(); send(NUMPAD[name]!); return; }
    const history = settings.history;
    if (e.key === 'ArrowUp' && history.length) {
      if (pos.current === -1) draft.current = text;
      pos.current = Math.min(pos.current + 1, history.length - 1); setText(history[pos.current]!); e.preventDefault();
    }
    if (e.key === 'ArrowDown' && pos.current >= 0) { pos.current -= 1; setText(pos.current >= 0 ? history[pos.current]! : draft.current); e.preventDefault(); }
    if (e.key === 'Escape' && text) { setText(''); pos.current = -1; }
  };
  return (
    <form className="chat-compose" onSubmit={submit}>
      <label htmlFor="mud-input" className="sr-only">{t('mud.command')}</label>
      <input id="mud-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys} placeholder={t('mud.command')} disabled={disabled}
        maxLength={1000} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="mud-input-hint" />
      <span id="mud-input-hint" className="sr-only">{t('mud.inputHint', { sep: settings.options.separator })}</span>
      <button className="btn btn-primary" type="submit" disabled={disabled}>{t('mud.send')}</button>
    </form>
  );
}

// ---------------------------------------------------------------- the side panel

function Side() {
  const t = useT();
  return (
    <aside className="mud-side" aria-label={t('mud.side')}>
      <Gauges />
      <MiniMap />
      <Windows />
    </aside>
  );
}

function Gauge({ label, value, max, kind }: { label: string; value: number; max: number; kind: string }) {
  const t = useT();
  return (
    <div className={`mud-gauge mud-gauge-${kind}`}>
      <div className="mud-gauge-head"><span>{label}</span><span>{t('mud.of', { value, max })}</span></div>
      <meter min={0} max={Math.max(1, max)} value={value} low={max * 0.3} high={max * 0.7} optimum={max} aria-label={`${label}: ${t('mud.of', { value, max })}`} />
    </div>
  );
}

function Gauges() {
  const t = useT();
  const v = useMud((s) => s.vitals);
  if (!v) return <section className="panel mud-card"><h2>{t('mud.vitals')}</h2><p className="hint">{t('mud.noVitals')}</p></section>;
  const prev = v.xp_prev ?? (v.level - 1) * (v.xp_next / Math.max(1, v.level)); // older servers sent no xp_prev
  return (
    <section className="panel mud-card" aria-labelledby="mud-vitals-h">
      <h2 id="mud-vitals-h">{t('mud.vitals')}</h2>
      <Gauge label={t('mud.hp')} value={v.hp} max={v.hp_max} kind="hp" />
      <Gauge label={t('mud.xp')} value={Math.max(0, v.xp - prev)} max={Math.max(1, v.xp_next - prev)} kind="xp" />
      <p className="mud-stats">
        <span>{t('mud.level', { level: v.level })}</span>
        <span>{t('mud.coins', { count: v.coins })}</span>
        {v.in_combat && <span className="badge badge-warn">{t('mud.inCombat')}</span>}
        {v.weakened && <span className="badge badge-warn">{t('mud.weakened')}</span>}
      </p>
    </section>
  );
}

const CELL = 34;

function MiniMap() {
  const t = useT();
  const { room, map, sendRaw } = useMud();
  if (!room) return null;
  const rooms = Object.values(map.rooms);
  const here = room.coord;
  const level = here ? rooms.filter((r) => r.coord[2] === here[2]) : [];
  const byId = map.rooms;
  // A window of the grid around where you are.
  const span = 3;
  const visible = here ? level.filter((r) => Math.abs(r.coord[0] - here[0]) <= span && Math.abs(r.coord[1] - here[1]) <= span) : [];
  const pos = (r: MapRoom) => ({ x: (r.coord[0] - here![0] + span) * CELL + CELL / 2, y: (here![1] - r.coord[1] + span) * CELL + CELL / 2 });
  const size = (span * 2 + 1) * CELL;
  return (
    <section className="panel mud-card" aria-labelledby="mud-map-h">
      <h2 id="mud-map-h">{room.area ? t('mud.mapIn', { area: room.area.name }) : t('mud.map')}</h2>
      {here && visible.length > 0 && (
        <svg className="mud-map" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t('mud.mapLabel', { room: room.name, count: rooms.length })}>
          {visible.flatMap((r) => r.exits.map((e) => {
            const d = e.to !== null ? byId[e.to] : undefined;
            if (!d || d.coord[2] !== r.coord[2] || d.id < r.id && d.exits.some((x) => x.to === r.id)) return null;
            const a = pos(r); const b = pos(d);
            return <line key={`${r.id}-${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="mud-map-link" />;
          }))}
          {visible.map((r) => {
            const p = pos(r);
            const isHere = r.id === room.id;
            const vert = r.exits.some((e) => { const d = e.to !== null ? byId[e.to] : undefined; return d && d.coord[2] !== r.coord[2]; });
            return (
              <g key={r.id}>
                <rect x={p.x - 9} y={p.y - 9} width={18} height={18} rx={3} className={isHere ? 'mud-map-room is-here' : 'mud-map-room'}><title>{r.name}</title></rect>
                {vert && <circle cx={p.x + 9} cy={p.y - 9} r={3} className="mud-map-stairs" />}
              </g>
            );
          })}
        </svg>
      )}
      <p className="mud-here"><strong>{room.name}</strong></p>
      {/* The exits, as buttons: the map in words, and a click walks. */}
      <ul className="plain mud-exits" aria-label={t('mud.exits')}>
        {room.exits.map((e) => (
          <li key={`${e.name}-${e.to}`}><button type="button" className="btn btn-quiet" onClick={() => sendRaw(e.name)}>{e.name}</button></li>
        ))}
        {!room.exits.length && <li className="hint">{t('mud.noExits')}</li>}
      </ul>
    </section>
  );
}

function Windows() {
  const t = useT();
  const { windows, unseen, seen } = useMud();
  const names = Object.keys(windows);
  const [open, setOpen] = useState<string | null>(null);
  const current = open && windows[open] ? open : names[0];
  useEffect(() => { if (current) seen(current); }, [current, windows, seen]);
  if (!names.length) return null;
  return (
    <section className="panel mud-card" aria-labelledby="mud-win-h">
      <h2 id="mud-win-h">{t('mud.windows')}</h2>
      <div className="tabs" role="tablist" aria-label={t('mud.windows')}>
        {names.map((n) => (
          <button key={n} type="button" role="tab" aria-selected={n === current} className={n === current ? 'is-active' : undefined} onClick={() => setOpen(n)}>
            {n}{n !== current && (unseen[n] ?? 0) > 0 && <span className="badge">{unseen[n]}</span>}
          </button>
        ))}
      </div>
      {current && <CaptureList lines={windows[current]!} name={current} />}
    </section>
  );
}

function CaptureList({ lines, name }: { lines: CaptureLine[]; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [lines]);
  return (
    <div ref={ref} className="mud-capture" role="log" aria-label={name} tabIndex={0}>
      {lines.map((l) => <p key={l.id}>{l.text}</p>)}
    </div>
  );
}
