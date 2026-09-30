import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { AnnouncementBox } from '../../components/Announcements';
import { errorText, formatWhen, useT } from '../../hooks';

interface SettingRow { key: string; value: unknown; default: unknown; overridden: boolean; version: number; risky: boolean; updated_at: string | null; updated_by: string | null }
type Change = { changed: true; version: number } | { pending: true; current: unknown; next: unknown; impact: { affected: number; note: string } | null };
interface HistoryRow { version: number; value: unknown; previous: unknown; reason: string; by: string | null; at: string; rolled_back_to: number | null }

const label = (key: string) => `setting.${key}` as StringKey;
const OPTIONS: Record<string, string[]> = { 'signup.mode': ['invite', 'open'] };
const shown = (t: ReturnType<typeof useT>, key: string, v: unknown): string =>
  typeof v === 'boolean' ? (v ? 'on' : 'off') : OPTIONS[key] ? t(`${label(key)}.${String(v)}` as StringKey) : String(v);

// ---------------------------------------------------------------- settings

export function SettingsPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<{ settings: SettingRow[]; readonly: { name: string; domain: string; homes_domain: string } }>('/admin/settings') });
  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  if (!q.data) return <p className="pad">{t('common.loading')}</p>;
  const r = q.data.readonly;
  return (
    <>
      <p className="hint">{t('admin.config.readonly', { name: r.name, domain: r.domain, homes: r.homes_domain })}</p>
      {q.data.settings.map((s) => <Setting key={s.key} s={s} />)}
    </>
  );
}

function Setting({ s }: { s: SettingRow }) {
  const t = useT();
  const qc = useQueryClient();
  const [value, setValue] = useState(String(s.value));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<Extract<Change, { pending: true }> | null>(null);
  const [history, setHistory] = useState(false);
  const name = t(label(s.key));
  const parse = (): unknown => (typeof s.value === 'boolean' ? value === 'true' : typeof s.value === 'number' ? Number(value) : value);
  const done = () => { setSaved(true); setPreview(null); setReason(''); void qc.invalidateQueries({ queryKey: ['admin'] }); };
  const send = useMutation({
    mutationFn: (v: { value: unknown; confirm: boolean }) => api.put<Change>(`/admin/settings/${s.key}`, { value: v.value, reason, confirm: v.confirm }),
    onSuccess: (r) => { setError(null); if ('pending' in r) setPreview(r); else done(); },
    onError: (e) => { setSaved(false); setError(errorText(e)); },
  });
  const id = `set-${s.key}`;
  return (
    <section className="setting-row" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>{name}</h3>
      <p className="hint">
        {t('admin.config.current', { value: shown(t, s.key, s.value) })} · {t('admin.config.default', { value: shown(t, s.key, s.default) })}
        {' · '}{s.overridden ? t('admin.config.version', { version: s.version, who: s.updated_by ?? '?' }) : t('admin.config.untouched')}
        {s.risky && ` · ${t('admin.config.risky')}`}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); setSaved(false); send.mutate({ value: parse(), confirm: false }); }}>
        <div className="field">
          <label htmlFor={id}>{t('admin.config.new')}</label>
          {OPTIONS[s.key] ? (
            <select id={id} value={value} onChange={(e) => setValue(e.target.value)}>{OPTIONS[s.key]!.map((o) => <option key={o} value={o}>{t(`${label(s.key)}.${o}` as StringKey)}</option>)}</select>
          ) : typeof s.value === 'boolean' ? (
            <select id={id} value={value} onChange={(e) => setValue(e.target.value)}><option value="true">on</option><option value="false">off</option></select>
          ) : (
            <input id={id} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
          )}
        </div>
        <TextField label={t('field.reason')} value={reason} onChange={setReason} hint={t('admin.user.reasonHint')} />
        {error && <Alert kind="error">{error}</Alert>}
        {saved && <Alert kind="success">{t('admin.config.saved')}</Alert>}
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={send.isPending || reason.trim().length < 3 || value === String(s.value)}>{t('admin.config.review')}</button>
          {s.overridden && <button type="button" className="btn" disabled={send.isPending || reason.trim().length < 3} onClick={() => send.mutate({ value: null, confirm: true })}>{t('admin.config.useFile')}</button>}
          <button type="button" className="btn btn-quiet" aria-expanded={history} onClick={() => setHistory(!history)}>{t('admin.config.showHistory', { name })}</button>
        </div>
      </form>
      {preview && (
        <div className="panel" role="group" aria-label={t('admin.config.review')}>
          <p>{t('admin.config.preview', { name, current: shown(t, s.key, preview.current), next: shown(t, s.key, preview.next) })}</p>
          <p>{preview.impact && preview.impact.affected > 0 ? t('admin.config.affected', { count: preview.impact.affected, note: preview.impact.note }) : t('admin.config.nobody')}</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => send.mutate({ value: parse(), confirm: true })} disabled={send.isPending}>{t('admin.config.confirm')}</button>
            <button className="btn btn-quiet" onClick={() => setPreview(null)}>{t('admin.config.cancel')}</button>
          </div>
        </div>
      )}
      {history && <History settingKey={s.key} name={name} onRolledBack={done} />}
    </section>
  );
}

function History({ settingKey, name, onRolledBack }: { settingKey: string; name: string; onRolledBack: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin', 'settings', settingKey, 'history'], queryFn: () => api.get<{ history: HistoryRow[] }>(`/admin/settings/${settingKey}/history`) });
  const back = useMutation({
    mutationFn: (version: number) => api.post(`/admin/settings/${settingKey}/rollback`, { version, reason }),
    onSuccess: () => { setError(null); onRolledBack(); void q.refetch(); }, onError: (e) => setError(errorText(e)),
  });
  return (
    <div className="panel" role="group" aria-label={t('admin.config.history', { name })}>
      {q.data?.history.length === 0 && <p>{t('admin.config.historyNone')}</p>}
      {(q.data?.history.length ?? 0) > 0 && <TextField label={t('field.reason')} value={reason} onChange={setReason} hint={t('admin.user.reasonHint')} />}
      {error && <Alert kind="error">{error}</Alert>}
      <ol className="timeline">
        {q.data?.history.map((h) => (
          <li key={h.version}>
            <strong>{t('admin.config.historyRow', { version: h.version, previous: String(h.previous), value: h.value === null ? '–' : String(h.value) })}</strong>
            <p className="hint">{h.by ?? '?'} · {formatWhen(h.at)} · {h.reason}{h.rolled_back_to ? ` · ${t('admin.config.rolledBack', { version: h.rolled_back_to })}` : ''}</p>
            {h.value !== null && <button type="button" className="link" disabled={back.isPending || reason.trim().length < 3} onClick={() => back.mutate(h.version)}>{t('admin.config.rollback', { version: h.version })}</button>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- announcements

interface AnnRow { id: string; title: string; body: string; level: 'info' | 'warning'; starts_at: string; ends_at: string | null; state: 'live' | 'scheduled' | 'ended' | 'archived' }
const iso = (local: string) => (local ? new Date(local).toISOString() : undefined);

export function AnnouncementsPanel() {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', body: '', level: 'info' as 'info' | 'warning', starts: '', ends: '' });
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin', 'announcements'], queryFn: () => api.get<{ announcements: AnnRow[] }>('/admin/announcements') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }); void qc.invalidateQueries({ queryKey: ['announcements'] }); };
  const create = useMutation({
    mutationFn: () => api.post('/admin/announcements', { title: f.title, body: f.body, level: f.level, starts_at: iso(f.starts), ends_at: iso(f.ends) }),
    onSuccess: () => { setF({ title: '', body: '', level: 'info', starts: '', ends: '' }); setError(null); refresh(); }, onError: (e) => setError(errorText(e)),
  });
  const end = useMutation({ mutationFn: (id: string) => api.del(`/admin/announcements/${id}`), onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  return (
    <>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}>
        <h2>{t('admin.ann.new')}</h2>
        <TextField label={t('admin.ann.title')} value={f.title} onChange={(v) => setF({ ...f, title: v })} maxLength={120} required />
        <TextField label={t('admin.ann.body')} value={f.body} onChange={(v) => setF({ ...f, body: v })} maxLength={2000} multiline />
        <div className="field">
          <label htmlFor="ann-level">{t('admin.ann.level')}</label>
          <select id="ann-level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as 'info' | 'warning' })}>
            <option value="info">{t('admin.ann.level.info')}</option><option value="warning">{t('admin.ann.level.warning')}</option>
          </select>
        </div>
        <div className="field"><label htmlFor="ann-start">{t('admin.ann.starts')}</label><input id="ann-start" type="datetime-local" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} /></div>
        <div className="field"><label htmlFor="ann-end">{t('admin.ann.ends')}</label><input id="ann-end" type="datetime-local" value={f.ends} onChange={(e) => setF({ ...f, ends: e.target.value })} /></div>
        {f.title && <><h3>{t('admin.ann.preview')}</h3><AnnouncementBox a={{ id: 'preview', title: f.title, body: f.body, level: f.level }} /></>}
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending}>{t('admin.ann.publish')}</button>
      </form>
      {list.data?.announcements.length === 0 && <p>{t('admin.ann.none')}</p>}
      <ul className="rows">
        {list.data?.announcements.map((a) => (
          <li key={a.id}>
            <strong>{a.title}</strong> <span className={`badge ${a.state === 'live' ? 'badge-open' : ''}`}>{t(`admin.ann.state.${a.state}`)}</span>
            <p className="hint">{formatWhen(a.starts_at)}{a.ends_at ? ` – ${formatWhen(a.ends_at)}` : ''}</p>
            {(a.state === 'live' || a.state === 'scheduled') && <button type="button" className="link" onClick={() => end.mutate(a.id)}>{t('admin.ann.end', { title: a.title })}</button>}
          </li>
        ))}
      </ul>
    </>
  );
}
