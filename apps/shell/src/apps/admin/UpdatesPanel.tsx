import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, Loading, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

// Updates and restarts (docs/19). The work is done on the server by `sitectl agent`; this page asks for it and shows how it went.
// While core itself restarts, requests fail for a moment: the page says so and keeps checking.

interface Job { id: string; action: 'restart' | 'upgrade' | 'check'; service: string | null; state: 'queued' | 'running' | 'done' | 'failed'; by: string | null; requested_at: string | null; started_at: string | null; finished_at: string | null }
interface Ops {
  configured: boolean; agent: { seen_at: string | null; alive: boolean };
  version: { commit: string; subject: string; date: string; branch: string; behind: number; pending: { commit: string; subject: string }[]; checked_at: string } | null;
  jobs: Job[];
}
const SERVICES = ['all', 'core', 'homes', 'shell', 'caddy', 'bbs', 'gopher', 'mud', 'ergo'] as const;

export function UpdatesPanel() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'ops'], queryFn: () => api.get<Ops>('/admin/ops'), refetchInterval: (query) => (query.state.data?.jobs.some((j) => j.state === 'queued' || j.state === 'running') ? 2000 : 10_000), retry: true });
  const [open, setOpen] = useState<string | null>(null);
  const check = useMutation({ mutationFn: () => api.post('/admin/ops', { action: 'check' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'ops'] }) });
  if (!q.data) return q.isError ? <Alert kind="info">{t('admin.ops.restarting')}</Alert> : <Loading />;
  const o = q.data;
  const busy = o.jobs.some((j) => j.state === 'queued' || j.state === 'running');
  return (
    <>
      <h2>{t('admin.ops.title')}</h2>
      {q.isError && <Alert kind="info">{t('admin.ops.restarting')}</Alert>}
      {!o.configured ? <Alert kind="info">{t('admin.ops.off')}</Alert> : (
        <>
          {!o.agent.alive && <Alert kind="warning">{o.agent.seen_at ? t('admin.ops.agentGone', { when: formatWhen(o.agent.seen_at) ?? '' }) : t('admin.ops.agentNever')}</Alert>}
          <section className="panel" aria-labelledby="ops-version">
            <div className="panel-head"><h3 id="ops-version">{t('admin.ops.version')}</h3></div>
            {o.version ? (
              <>
                <p><code>{o.version.commit.slice(0, 12)}</code> {o.version.subject} <span className="hint">({o.version.branch}, {formatWhen(o.version.date)})</span></p>
                <p className="hint">{t('admin.ops.checked', { when: formatWhen(o.version.checked_at) ?? '' })}</p>
                {o.version.behind === 0 ? <p>{t('admin.ops.upToDate')}</p> : (
                  <>
                    <p><strong>{t('admin.ops.behind', { count: o.version.behind })}</strong></p>
                    <ul className="plain ops-pending">{o.version.pending.map((p) => <li key={p.commit}><code>{p.commit}</code> {p.subject}</li>)}</ul>
                  </>
                )}
              </>
            ) : <p className="hint">{t('admin.ops.noVersion')}</p>}
            <div className="toolbar">
              <button type="button" className="btn" disabled={check.isPending || !o.agent.alive} onClick={() => check.mutate()}>{t('admin.ops.check')}</button>
            </div>
            {check.error && <Alert kind="error">{errorText(check.error)}</Alert>}
          </section>
          <Ask kind="upgrade" disabled={busy || !o.agent.alive} />
          <Ask kind="restart" disabled={busy || !o.agent.alive} />
        </>
      )}
      {o.jobs.length > 0 && (
        <section className="panel" aria-labelledby="ops-jobs">
          <div className="panel-head"><h3 id="ops-jobs">{t('admin.ops.jobs')}</h3></div>
          <table className="table">
            <thead><tr><th scope="col">{t('admin.ops.col.what')}</th><th scope="col">{t('admin.ops.col.state')}</th><th scope="col">{t('admin.ops.col.who')}</th><th scope="col">{t('admin.ops.col.when')}</th><th scope="col"><span className="sr-only">{t('admin.ops.log')}</span></th></tr></thead>
            <tbody>
              {o.jobs.map((j) => (
                <tr key={j.id}>
                  <th scope="row" data-label={t('admin.ops.col.what')}>{t(`admin.ops.action.${j.action}` as StringKey)}{j.service ? `: ${j.service}` : ''}</th>
                  <td data-label={t('admin.ops.col.state')}><span className={`badge ${j.state === 'done' ? 'badge-open' : j.state === 'failed' ? 'badge-warn' : ''}`}>{t(`admin.ops.state.${j.state}` as StringKey)}</span></td>
                  <td data-label={t('admin.ops.col.who')}>{j.by ?? '–'}</td>
                  <td data-label={t('admin.ops.col.when')}>{j.requested_at ? formatWhen(j.requested_at) : '–'}</td>
                  <td>{j.state !== 'queued' && <button type="button" className="btn btn-quiet" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)}>{t('admin.ops.log')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {open && <Log id={open} running={o.jobs.find((j) => j.id === open)?.state === 'running'} />}
        </section>
      )}
    </>
  );
}

// Updating or restarting: say what will happen, and ask for the password again.
function Ask({ kind, disabled }: { kind: 'upgrade' | 'restart'; disabled: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [service, setService] = useState<typeof SERVICES[number]>('all');
  const go = useMutation({
    mutationFn: () => api.post('/admin/ops', { action: kind, ...(kind === 'restart' ? { service } : {}), password }),
    onSuccess: () => { setPassword(''); void qc.invalidateQueries({ queryKey: ['admin', 'ops'] }); },
  });
  const id = `ops-${kind}`;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head"><h3 id={id}>{t(`admin.ops.${kind}Title` as StringKey)}</h3></div>
      <p className="hint">{t(`admin.ops.${kind}Hint` as StringKey)}</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); go.mutate(); }}>
        {kind === 'restart' && (
          <div className="field">
            <label htmlFor="ops-service">{t('admin.ops.service')}</label>
            <select id="ops-service" value={service} onChange={(e) => setService(e.target.value as typeof service)}>
              {SERVICES.map((s) => <option key={s} value={s}>{s === 'all' ? t('admin.ops.allServices') : s}</option>)}
            </select>
          </div>
        )}
        <TextField label={t('admin.ops.password')} type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
        {go.error && <Alert kind="error">{errorText(go.error)}</Alert>}
        {go.isSuccess && <Alert kind="success">{t('admin.ops.asked')}</Alert>}
        <button type="submit" className={`btn ${kind === 'upgrade' ? 'btn-primary' : ''}`} disabled={disabled || go.isPending || !password}>{t(`admin.ops.${kind}Go` as StringKey)}</button>
      </form>
    </section>
  );
}

function Log({ id, running }: { id: string; running: boolean }) {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'ops', id, 'log'], queryFn: () => api.get<{ log: string; truncated: boolean }>(`/admin/ops/${id}/log`), refetchInterval: running ? 2000 : false });
  return (
    <div className="ops-log">
      <h4>{t('admin.ops.logFor', { id })}</h4>
      {q.data?.truncated && <p className="hint">{t('admin.ops.truncated')}</p>}
      <pre tabIndex={0} aria-label={t('admin.ops.log')}>{q.data ? q.data.log || t('admin.ops.logEmpty') : '…'}</pre>
    </div>
  );
}
