import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminStats, ConsoleCommandSpec, ConsoleResult } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api, ApiError } from '../../api';
import { Alert, BackLink, Loading, EmptyState } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { AppLink } from '../../nav';
import { diffFields, replayState } from './diff';

interface HistoryRow { id: number; at: string; actor_handle: string | null; actor_kind: string; action: string; target_type: string | null; target_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

// ---------------------------------------------------------------- audit replay (docs/11 §3)

// How one object changed, step by step, oldest first, with each step's diff and the state after it.
export function AuditReplay({ type, id }: { type: string; id: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'replay', type, id], queryFn: () => api.get<{ entries: HistoryRow[] }>(`/admin/audit/object/${encodeURIComponent(type)}/${encodeURIComponent(id)}?limit=200`) });
  const steps = useMemo(() => [...(q.data?.entries ?? [])].reverse(), [q.data]);
  const [at, setAt] = useState<number | null>(null);
  const i = at ?? steps.length - 1;
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading />;
  const back = <p><BackLink to="audit">{t('admin.replay.back')}</BackLink>{type === 'user' && <> · <AppLink to={`users/${id}`}>{t('admin.replay.dossier')}</AppLink></>}</p>;
  if (steps.length === 0) return <>{back}<EmptyState>{t('admin.replay.none')}</EmptyState></>;
  const step = steps[i]!;
  const changes = diffFields(step.before, step.after).filter((c) => c.kind !== 'same');
  const state = replayState(steps, i);
  const reason = typeof step.after?.reason === 'string' ? step.after.reason : typeof step.after?.note === 'string' ? step.after.note : null;
  return (
    <section aria-labelledby="replay-h">
      {back}
      <h2 id="replay-h">{t('admin.replay.title', { type, id })}</h2>
      <div className="replay-scrub">
        <button type="button" className="btn" onClick={() => setAt(Math.max(0, i - 1))} disabled={i === 0}>{t('admin.replay.prev')}</button>
        <label htmlFor="replay-step" className="visually-hidden">{t('admin.replay.step')}</label>
        <input id="replay-step" type="range" min={0} max={steps.length - 1} value={i} onChange={(e) => setAt(Number(e.target.value))}
          aria-valuetext={t('admin.replay.stepOf', { n: i + 1, total: steps.length })} />
        <button type="button" className="btn" onClick={() => setAt(Math.min(steps.length - 1, i + 1))} disabled={i === steps.length - 1}>{t('admin.replay.next')}</button>
      </div>
      <p role="status"><strong>{t('admin.replay.stepOf', { n: i + 1, total: steps.length })}</strong> · <time dateTime={step.at}>{formatWhen(step.at)}</time> · <code>{step.action}</code> · {t('admin.audit.by', { actor: step.actor_handle ?? step.actor_kind })}</p>
      {reason && <p><q>{reason}</q></p>}
      <h3>{t('admin.replay.changes')}</h3>
      {changes.length === 0 ? <p className="muted">{t('admin.replay.noChanges')}</p> : (
        <table className="table diff-table">
          <thead><tr><th scope="col">{t('admin.replay.field')}</th><th scope="col">{t('admin.replay.before')}</th><th scope="col">{t('admin.replay.after')}</th></tr></thead>
          <tbody>{changes.map((c) => (
            <tr key={c.field} className={`diff-${c.kind}`}>
              <th scope="row" data-label={t('admin.replay.field')}>{c.field}</th>
              <td data-label={t('admin.replay.before')}>{c.before === null ? <span className="muted">{t('admin.replay.empty')}</span> : <del>{c.before}</del>}</td>
              <td data-label={t('admin.replay.after')}>{c.after === null ? <span className="muted">{t('admin.replay.empty')}</span> : <ins>{c.after}</ins>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <h3>{t('admin.replay.state')}</h3>
      <dl className="replay-state">{Object.entries(state).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <h3>{t('admin.replay.all')}</h3>
      <ol className="timeline">{steps.map((s, n) => (
        <li key={s.id} className={n === i ? 'is-current' : undefined}>
          <button type="button" className="link" onClick={() => setAt(n)} aria-current={n === i ? 'step' : undefined}>{formatWhen(s.at)} · {s.action}</button>
        </li>
      ))}</ol>
    </section>
  );
}

// ---------------------------------------------------------------- stats (docs/11 §9)

function LineChart({ label, series, days }: { label: string; series: { name: string; values: number[]; cls: string }[]; days: string[] }) {
  const w = 600, h = 160, pad = 24;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (n: number) => pad + (n * (w - pad * 2)) / Math.max(1, days.length - 1);
  const y = (v: number) => h - pad - (v * (h - pad * 2)) / max;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} preserveAspectRatio="none">
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} className="chart-axis" />
        {series.map((s) => <polyline key={s.name} className={`chart-line ${s.cls}`} fill="none" points={s.values.map((v, n) => `${x(n)},${y(v)}`).join(' ')} />)}
        <text x={pad} y={pad - 8} className="chart-label">{max}</text>
      </svg>
      <figcaption>{series.map((s) => <span key={s.name} className={`chart-key ${s.cls}`}>{s.name} {s.values.at(-1)}</span>)}</figcaption>
    </figure>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function StatsPanel() {
  const t = useT();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: ['admin', 'stats', days], queryFn: () => api.get<AdminStats>(`/admin/stats?days=${days}&weeks=12`) });
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const s = q.data;
  const csv = (kind: string) => `/api/v1/admin/stats.csv?kind=${kind}&days=${days}&weeks=12`;
  const heatMax = s ? Math.max(1, ...s.heatmap.flat()) : 1;
  return (
    <section aria-labelledby="stats-h">
      <h2 id="stats-h">{t('admin.stats.title')}</h2>
      <div className="field">
        <label htmlFor="stats-range">{t('admin.stats.range')}</label>
        <select id="stats-range" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 90, 180, 365].map((d) => <option key={d} value={d}>{t('admin.stats.days', { count: d })}</option>)}
        </select>
      </div>
      <p className="hint">{t('admin.stats.utc')}</p>
      {!s ? <Loading /> : (
        <>
          <ul className="inline-list stat-totals">{Object.entries(s.totals).map(([k, v]) => <li key={k}><strong>{v}</strong> {t(`admin.stats.total.${k}` as StringKey, { count: v })}</li>)}</ul>
          <h3>{t('admin.stats.active')}</h3>
          <LineChart label={t('admin.stats.activeLabel')} days={s.days.map((d) => d.day)} series={[
            { name: t('admin.stats.mau'), values: s.days.map((d) => d.mau), cls: 's3' },
            { name: t('admin.stats.wau'), values: s.days.map((d) => d.wau), cls: 's2' },
            { name: t('admin.stats.dau'), values: s.days.map((d) => d.dau), cls: 's1' },
          ]} />
          <h3>{t('admin.stats.content')}</h3>
          <LineChart label={t('admin.stats.contentLabel')} days={s.days.map((d) => d.day)} series={[
            { name: t('admin.stats.posts'), values: s.days.map((d) => d.posts), cls: 's1' },
            { name: t('admin.stats.signups'), values: s.days.map((d) => d.signups), cls: 's2' },
          ]} />
          <p><a href={csv('days')} download>{t('admin.stats.csvDays')}</a></p>

          <h3>{t('admin.stats.cohorts')}</h3>
          <p className="hint">{t('admin.stats.cohortsHint')}</p>
          {s.cohorts.length === 0 ? <p className="muted">{t('admin.stats.noCohorts')}</p> : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label={t('admin.stats.cohorts')}>
              <table className="table cohort-table">
                <thead><tr><th scope="col">{t('admin.stats.week')}</th><th scope="col">{t('admin.stats.size')}</th>
                  {Array.from({ length: Math.max(...s.cohorts.map((c) => c.active.length)) }, (_, n) => <th key={n} scope="col">{t('admin.stats.weekN', { n })}</th>)}</tr></thead>
                <tbody>{s.cohorts.map((c) => (
                  <tr key={c.week}><th scope="row">{c.week}</th><td>{c.size}</td>
                    {c.active.map((n, k) => { const pct = c.size ? Math.round((n / c.size) * 100) : 0; return <td key={k} style={{ ['--heat' as string]: pct / 100 }} className="heat">{pct}%</td>; })}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p><a href={csv('cohorts')} download>{t('admin.stats.csvCohorts')}</a></p>

          <h3>{t('admin.stats.heatmap')}</h3>
          <p className="hint">{t('admin.stats.heatmapHint')}</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label={t('admin.stats.heatmap')}>
            <table className="table heatmap">
              <thead><tr><th scope="col"><span className="visually-hidden">{t('admin.stats.weekday')}</span></th>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>{s.heatmap.map((row, d) => (
                <tr key={d}><th scope="row">{DAYS[d]}</th>{row.map((n, h) => <td key={h} className="heat" style={{ ['--heat' as string]: n / heatMax }} title={`${DAYS[d]} ${h}:00 — ${n}`}>{n || ''}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          <p><a href={csv('heatmap')} download>{t('admin.stats.csvHeatmap')}</a></p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- command console (docs/11 §11)

interface Entry { command: string; result?: ConsoleResult; error?: string }

// Completes the word under the cursor: command names first, then handles for arguments called "handle".
export function complete(line: string, specs: ConsoleCommandSpec[], handles: string[]): string[] {
  const words = line.split(/\s+/);
  const typed = words.slice(0, -1);
  const last = words.at(-1) ?? '';
  const names = specs.map((s) => s.name.split(' '));
  if (typed.length < 2) {
    const prefix = [...typed, last].join(' ');
    const hits = [...new Set(names.map((n) => n.join(' ')).filter((n) => n.startsWith(prefix)))];
    if (hits.length && !(hits.length === 1 && hits[0] === prefix)) return hits;
  }
  const spec = specs.find((s) => typed.join(' ').startsWith(s.name));
  if (!spec) return [];
  const argIndex = typed.length - spec.name.split(' ').length;
  if (spec.args[argIndex] === 'handle') return handles.filter((h) => h.toLowerCase().startsWith(last.toLowerCase())).map((h) => [...typed, h].join(' '));
  return [];
}

export function CommandConsole() {
  const t = useT();
  const [line, setLine] = useState('');
  const [log, setLog] = useState<Entry[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState<number | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const specs = useQuery({ queryKey: ['admin', 'console', 'commands'], queryFn: () => api.get<{ commands: ConsoleCommandSpec[] }>('/admin/console/commands') }).data?.commands ?? [];
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [log]);

  const run = async () => {
    const command = line.trim();
    if (!command || busy) return;
    setBusy(true); setHints([]); setLine(''); setHi(null);
    setHist((h) => [...h.filter((x) => x !== command), command].slice(-100));
    try {
      const result = await api.post<ConsoleResult>('/admin/console', { command });
      setLog((l) => [...l, { command, result }]);
    } catch (e) {
      setLog((l) => [...l, { command, error: e instanceof ApiError ? e.message : errorText(e) }]);
    } finally { setBusy(false); }
  };
  const onKey = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void run(); }
    else if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); const n = hi === null ? hist.length - 1 : Math.max(0, hi - 1); setHi(n); setLine(hist[n]!); }
    else if (e.key === 'ArrowDown' && hi !== null) { e.preventDefault(); const n = hi + 1; if (n >= hist.length) { setHi(null); setLine(''); } else { setHi(n); setLine(hist[n]!); } }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const last = line.split(/\s+/).at(-1) ?? '';
      let handles: string[] = [];
      if (last.length >= 1) handles = (await api.get<{ users: { handle: string }[] }>(`/admin/users?q=${encodeURIComponent(last)}&limit=10`).catch(() => ({ users: [] }))).users.map((u) => u.handle);
      const hits = complete(line, specs, handles);
      if (hits.length === 1) { setLine(`${hits[0]} `); setHints([]); } else setHints(hits.slice(0, 12));
    }
  };
  return (
    <section aria-labelledby="console-h" className="command-console">
      <h2 id="console-h">{t('admin.console.title')}</h2>
      <p className="hint">{t('admin.console.intro')}</p>
      <div className="console-log" role="log" aria-live="polite" aria-label={t('admin.console.output')} tabIndex={0}>
        {log.map((e, n) => (
          <div key={n} className="console-entry">
            <div className="console-cmd"><span aria-hidden="true">&gt; </span>{e.command}</div>
            {e.error && <div className="console-error">{e.error}</div>}
            {e.result?.lines.map((l, k) => <div key={k}>{l}</div>)}
            {e.result?.table && (
              <table className="table console-table">
                <thead><tr>{e.result.table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                <tbody>{e.result.table.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="console-input">
        <label htmlFor="console-line">{t('admin.console.label')}</label>
        <input id="console-line" value={line} onChange={(e) => { setLine(e.target.value); setHi(null); }} onKeyDown={(e) => void onKey(e)}
          autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="console-keys" disabled={busy} />
        <p id="console-keys" className="hint">{t('admin.console.keys')}</p>
        {hints.length > 0 && <ul className="console-hints" aria-label={t('admin.console.hints')}>{hints.map((h) => <li key={h}><button type="button" className="link" onClick={() => { setLine(`${h} `); setHints([]); document.getElementById('console-line')?.focus(); }}>{h}</button></li>)}</ul>}
      </form>
    </section>
  );
}
