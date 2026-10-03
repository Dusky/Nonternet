import { THEMES } from '@app/shared';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, TextField, Loading, EmptyState } from '../../components/ui';
import { AnnouncementBox } from '../../components/Announcements';
import { errorText, formatWhen, useSite, useT } from '../../hooks';

interface SettingRow { key: string; value: unknown; default: unknown; overridden: boolean; version: number; risky: boolean; updated_at: string | null; updated_by: string | null }
type Change = { changed: true; version: number } | { pending: true; current: unknown; next: unknown; impact: { affected: number; note: string } | null };
interface HistoryRow { version: number; value: unknown; previous: unknown; reason: string; by: string | null; at: string; rolled_back_to: number | null }

const label = (key: string) => `setting.${key}` as StringKey;
const OPTIONS: Record<string, string[]> = { 'signup.mode': ['invite', 'open', 'application'], 'ui.default_theme': [...THEMES] };
const shown = (t: ReturnType<typeof useT>, key: string, v: unknown): string =>
  typeof v === 'boolean' ? t(v ? 'admin.config.on' : 'admin.config.off') : OPTIONS[key] ? t(`${label(key)}.${String(v)}` as StringKey) : String(v);

// ---------------------------------------------------------------- settings

export function SettingsPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api.get<{ settings: SettingRow[]; readonly: { name: string; domain: string; homes_domain: string } }>('/admin/settings') });
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading />;
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
        {typeof s.value === 'boolean' && !OPTIONS[s.key] ? (
          <label className="check switch">
            <input id={id} type="checkbox" role="switch" checked={value === 'true'} onChange={(e) => setValue(String(e.target.checked))} />
            <span>{t('admin.config.newSwitch')}</span>
          </label>
        ) : (
        <div className="field">
          <label htmlFor={id}>{t('admin.config.new')}</label>
          {OPTIONS[s.key] ? (
            <select id={id} value={value} onChange={(e) => setValue(e.target.value)}>{OPTIONS[s.key]!.map((o) => <option key={o} value={o}>{t(`${label(s.key)}.${o}` as StringKey)}</option>)}</select>
          ) : typeof s.value === 'string' ? (
            <textarea id={id} rows={4} value={value} onChange={(e) => setValue(e.target.value)} maxLength={2000} />
          ) : (
            <input id={id} type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
          )}
        </div>
        )}
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
  const site = useSite();
  const [f, setF] = useState({ title: '', body: '', level: 'info' as 'info' | 'warning', starts: '', ends: '', irc: false, mud: false });
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin', 'announcements'], queryFn: () => api.get<{ announcements: AnnRow[] }>('/admin/announcements') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }); void qc.invalidateQueries({ queryKey: ['announcements'] }); };
  const create = useMutation({
    mutationFn: () => api.post('/admin/announcements', { title: f.title, body: f.body, level: f.level, starts_at: iso(f.starts), ends_at: iso(f.ends), irc: f.irc, mud: f.mud }),
    onSuccess: () => { setF({ title: '', body: '', level: 'info', starts: '', ends: '', irc: false, mud: false }); setError(null); refresh(); }, onError: (e) => setError(errorText(e)),
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
        {site.services.irc && <label className="check"><input type="checkbox" checked={f.irc} onChange={(e) => setF({ ...f, irc: e.target.checked })} />{t('admin.ann.irc', { channel: site.irc.lobby })}</label>}
        {site.services.mud && <label className="check"><input type="checkbox" checked={f.mud} onChange={(e) => setF({ ...f, mud: e.target.checked })} />{t('admin.ann.mud')}</label>}
        {f.title && <><h3>{t('admin.ann.preview')}</h3><AnnouncementBox a={{ id: 'preview', title: f.title, body: f.body, level: f.level }} /></>}
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending}>{t('admin.ann.publish')}</button>
      </form>
      {list.data?.announcements.length === 0 && <EmptyState>{t('admin.ann.none')}</EmptyState>}
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

// ---------------------------------------------------------------- legal pages and takedown requests

interface LegalPageRow { slug: string; title: string; body: string; version: number; updated_at: string | null; placeholder: boolean }
interface LegalRequestRow { id: string; kind: string; url: string; description: string; contact_name: string; contact_email: string; status: 'open' | 'actioned' | 'declined'; created_at: string; resolved_at: string | null; resolved_by: string | null; resolution_note: string | null }

function LegalEditor({ page }: { page: LegalPageRow }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const versions = useQuery({ queryKey: ['admin', 'legal-versions', page.slug, page.version], queryFn: () => api.get<{ versions: { version: number; reason: string; changed_at: string; changed_by: string | null }[] }>(`/admin/legal/pages/${page.slug}/versions`), enabled: open && page.version > 0 });
  const save = useMutation({
    mutationFn: () => api.put<{ version: number }>(`/admin/legal/pages/${page.slug}`, { title, body, reason }),
    onSuccess: (r) => { setMsg({ ok: true, text: t('admin.legal.saved', { version: r.version }) }); setReason(''); void qc.invalidateQueries({ queryKey: ['admin', 'legal'] }); void qc.invalidateQueries({ queryKey: ['legal'] }); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  return (
    <section className="panel" aria-label={page.title}>
      <h3>{page.title}</h3>
      {page.placeholder && <p className="hint">{t('admin.legal.placeholderNote')}</p>}
      {!open ? <button className="btn" type="button" onClick={() => setOpen(true)} aria-label={`${t('admin.legal.edit')} ${page.title}`}>{t('admin.legal.edit')}</button> : (
        <form onSubmit={(e) => { e.preventDefault(); setMsg(null); save.mutate(); }}>
          <TextField label={t('admin.legal.title')} value={title} onChange={setTitle} maxLength={120} required />
          <TextField label={t('admin.legal.body')} value={body} onChange={setBody} hint={t('admin.legal.bodyHint')} multiline maxLength={60000} required />
          <TextField label={t('admin.legal.reason')} value={reason} onChange={setReason} maxLength={500} required />
          {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>{t('admin.legal.save')}</button>
          {versions.data && versions.data.versions.length > 0 && (
            <details>
              <summary>{t('admin.legal.versions')}</summary>
              <ul>{versions.data.versions.map((v) => <li key={v.version}>v{v.version}: {v.reason} ({v.changed_by ?? '–'}, {formatWhen(v.changed_at)})</li>)}</ul>
            </details>
          )}
        </form>
      )}
    </section>
  );
}

function LegalRequest({ r }: { r: LegalRequestRow }) {
  const t = useT();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: (status: 'actioned' | 'declined') => api.post(`/admin/legal/requests/${r.id}/resolve`, { status, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'legal'] }),
    onError: (e) => setError(errorText(e)),
  });
  return (
    <li className="panel">
      <p><strong>{t(`legal.takedown.kind.${r.kind}` as StringKey)}</strong> <a href={r.url} rel="noreferrer noopener" target="_blank">{r.url}</a></p>
      <p>{r.description}</p>
      <p className="hint">{t('admin.legal.from', { name: r.contact_name, email: r.contact_email, when: formatWhen(r.created_at) ?? '' })}</p>
      {r.status === 'open' ? (
        <form onSubmit={(e) => e.preventDefault()} aria-label={`${r.contact_name} ${r.kind}`}>
          <TextField label={t('admin.legal.resolution')} value={note} onChange={setNote} maxLength={1000} />
          {error && <Alert kind="error">{error}</Alert>}
          <div className="actions">
            <button className="btn btn-primary" type="button" disabled={resolve.isPending} onClick={() => { setError(null); resolve.mutate('actioned'); }}>{t('admin.legal.actioned')}</button>
            <button className="btn" type="button" disabled={resolve.isPending} onClick={() => { setError(null); resolve.mutate('declined'); }}>{t('admin.legal.declined')}</button>
          </div>
        </form>
      ) : <p><span className="badge">{t(`admin.legal.resolved.${r.status}` as StringKey)}</span> {t('admin.legal.resolvedBy', { who: r.resolved_by ?? '–', when: formatWhen(r.resolved_at) ?? '', note: r.resolution_note ?? '' })}</p>}
    </li>
  );
}

export function LegalPanel() {
  const t = useT();
  const pages = useQuery({ queryKey: ['admin', 'legal', 'pages'], queryFn: () => api.get<{ pages: LegalPageRow[] }>('/admin/legal/pages') });
  const reqs = useQuery({ queryKey: ['admin', 'legal', 'requests'], queryFn: () => api.get<{ requests: LegalRequestRow[] }>('/admin/legal/requests'), refetchInterval: 60_000 });
  if (pages.isError) return <Alert kind="error" retry={() => void pages.refetch()}>{errorText(pages.error)}</Alert>;
  return (
    <>
      <h2>{t('admin.legal.requests')}</h2>
      {reqs.data && reqs.data.requests.length === 0 && <p>{t('admin.legal.noRequests')}</p>}
      <ul className="plain">{reqs.data?.requests.map((r) => <LegalRequest key={r.id} r={r} />)}</ul>
      <h2>{t('admin.legal.pages')}</h2>
      {pages.data?.pages.map((p) => <LegalEditor key={p.slug} page={p} />)}
    </>
  );
}
