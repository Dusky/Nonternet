import { useConfirm } from '../../components/feedback';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@app/shared';
import { en, type StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, TextField, EmptyState } from '../../components/ui';
import { Section } from './Section';
import { errorText, formatWhen, useT } from '../../hooks';

interface ExportRow { id: string; status: 'queued' | 'running' | 'ready' | 'failed' | 'expired'; requested_at: string; ready_at: string | null; expires_at: string | null; size_bytes: number | null; includes_private_key: boolean; error: string | null }
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function YourData({ me }: { me: Me }) {
  return <><ExportSection /><ImportSection /><DeleteSection me={me} /></>;
}

function ExportSection() {
  const t = useT();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [key, setKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // While one is being built, look again every few seconds.
  const list = useQuery({
    queryKey: ['exports'],
    queryFn: () => api.get<{ exports: ExportRow[] }>('/me/exports'),
    refetchInterval: (q) => (q.state.data?.exports.some((e) => e.status === 'queued' || e.status === 'running') ? 3000 : false),
  });
  const ask = useMutation({
    mutationFn: () => api.post('/me/export', { password, include_private_key: key }),
    onSuccess: () => { setPassword(''); setError(null); setNote(t('data.export.requested')); void qc.invalidateQueries({ queryKey: ['exports'] }); },
    onError: (e) => { setNote(null); setError(errorText(e)); },
  });
  return (
    <Section id="export-h" title={t('data.export.title')} scope="account">
      <p>{t('data.export.intro')}</p>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); ask.mutate(); }}>
        <TextField label={t('data.export.password')} hint={t('data.export.passwordHint')} type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
        <label className="check"><input type="checkbox" checked={key} onChange={(e) => setKey(e.target.checked)} />{t('data.export.includeKey')}</label>
        {error && <Alert kind="error">{error}</Alert>}
        {note && <Alert kind="success">{note}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={ask.isPending}>{t('data.export.request')}</button>
      </form>
      <h3>{t('data.export.list')}</h3>
      {list.data?.exports.length === 0 && <EmptyState>{t('data.export.none')}</EmptyState>}
      <ul className="rows">
        {list.data?.exports.map((x) => (
          <li key={x.id}>
            <span className={`badge ${x.status === 'ready' ? 'badge-open' : x.status === 'failed' ? 'badge-warn' : ''}`}>{t(`data.export.status.${x.status}`)}</span>{' '}
            {formatWhen(x.requested_at)}{x.includes_private_key ? ` · ${t('data.export.withKey')}` : ''}
            {x.status === 'ready' && (
              <p>
                <a href={`/api/v1/me/exports/${x.id}/download`} download>{t('data.export.download', { when: `${formatWhen(x.ready_at) ?? ''} (${size(x.size_bytes ?? 0)})` })}</a>
                <span className="hint"> · {t('data.export.expires', { when: formatWhen(x.expires_at) ?? '' })}</span>
              </p>
            )}
            {x.error && <p className="muted">{x.error}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Bringing back an export (docs/12): upload, look at what would come back, then bring it back with the password.
type Part = 'profile' | 'settings' | 'avatar' | 'homepage' | 'files' | 'keys' | 'clients' | 'apps';
interface Issue { code: string; count: number }
interface Preview { id: string; origin: 'this_site' | 'other_site'; site: { name: string; domain: string }; handle: string; generated_at: string; parts: { part: Part; count: number; issues: Issue[] }[]; skipped: { kind: string; count: number }[] }
interface Result { parts: { part: Part; restored: number; issues: Issue[] }[] }
// Known reasons get their own sentence; anything else (a quota, a file type) is counted plainly.
const issueText = (t: ReturnType<typeof useT>, i: Issue) => t((`data.import.issue.${i.code}` in en ? `data.import.issue.${i.code}` : 'data.import.issue.other') as StringKey, { count: i.count });

function ImportSection() {
  const t = useT();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [replace, setReplace] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<Preview>('/me/import', f, 'POST'),
    onSuccess: (p) => { setPreview(p); setParts(p.parts.map((x) => x.part)); setResult(null); setError(null); },
    onError: (e) => { setPreview(null); setError(errorText(e)); },
  });
  const apply = useMutation({
    mutationFn: () => api.post<Result>(`/me/import/${preview!.id}/apply`, { password, parts, replace_homepage: replace }),
    onSuccess: (r) => { setResult(r); setPreview(null); setPassword(''); setError(null); void qc.invalidateQueries(); },
    onError: (e) => setError(errorText(e)),
  });
  const toggle = (p: Part, on: boolean) => setParts((now) => (on ? [...now, p] : now.filter((x) => x !== p)));
  return (
    <Section id="import-h" title={t('data.import.title')} scope="account">
      <p>{t('data.import.intro')}</p>
      <div className="field">
        <label htmlFor="import-file">{t('data.import.file')}</label>
        <input id="import-file" type="file" accept=".zip,application/zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} disabled={upload.isPending} />
      </div>
      {upload.isPending && <p className="muted" role="status">{t('data.import.checking')}</p>}
      {preview && (
        <form onSubmit={(e) => { e.preventDefault(); setError(null); apply.mutate(); }} aria-labelledby="import-preview-h">
          <h3 id="import-preview-h">{t('data.import.previewTitle', { handle: preview.handle, site: preview.site.domain, when: formatWhen(preview.generated_at) ?? '' })}</h3>
          <Alert kind={preview.origin === 'this_site' ? 'success' : 'info'}>{t(preview.origin === 'this_site' ? 'data.import.originHere' : 'data.import.originElsewhere')}</Alert>
          <fieldset>
            <legend>{t('data.import.willRestore')}</legend>
            {preview.parts.length === 0 && <p className="muted">{t('data.import.nothing')}</p>}
            {preview.parts.map((p) => (
              <label key={p.part} className="check">
                <input type="checkbox" checked={parts.includes(p.part)} onChange={(e) => toggle(p.part, e.target.checked)} />
                <span><strong>{t(`data.import.part.${p.part}` as StringKey, { count: p.count })}</strong>
                  {p.issues.length > 0 && <span className="hint"> {p.issues.map((i) => issueText(t, i)).join(' ')}</span>}</span>
              </label>
            ))}
            {preview.parts.some((p) => p.part === 'homepage' && p.issues.some((i) => i.code === 'exists')) && (
              <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />{t('data.import.replace')}</label>
            )}
          </fieldset>
          {preview.skipped.length > 0 && (
            <>
              <h4>{t('data.import.staysTitle')}</h4>
              <p className="hint">{t('data.import.staysIntro')}</p>
              <ul className="plain">{preview.skipped.map((s) => <li key={s.kind}>{t(`data.import.skip.${s.kind}` as StringKey, { count: s.count })}</li>)}</ul>
            </>
          )}
          <TextField label={t('data.export.password')} type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
          {error && <Alert kind="error">{error}</Alert>}
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={apply.isPending || parts.length === 0}>{t('data.import.apply')}</button>
            <button className="btn btn-quiet" type="button" onClick={() => { setPreview(null); setError(null); }}>{t('data.import.cancel')}</button>
          </div>
        </form>
      )}
      {!preview && error && <Alert kind="error">{error}</Alert>}
      {result && (
        <Alert kind="success">
          <strong>{t('data.import.done')}</strong>
          <ul className="plain">{result.parts.map((p) => (
            <li key={p.part}>{t(`data.import.restored.${p.part}` as StringKey, { count: p.restored })}{p.issues.length > 0 && <span className="hint"> {p.issues.map((i) => issueText(t, i)).join(' ')}</span>}</li>
          ))}</ul>
        </Alert>
      )}
    </Section>
  );
}

function DeleteSection({ me }: { me: Me }) {
  const t = useT();
  const confirm = useConfirm();
  const [f, setF] = useState({ password: '', handle: '', code: '' });
  const [posts, setPosts] = useState<'keep' | 'erase'>('keep');
  const [error, setError] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: () => api.post('/me/delete', {
      password: f.password, confirm_handle: f.handle, posts,
      ...(me.totp_enabled ? (/^\d{6}$/.test(f.code.trim()) ? { totp: f.code.trim() } : { recovery_code: f.code.trim() }) : {}),
    }),
    // A full page load, so nothing of this account stays in memory.
    onSuccess: () => window.location.assign('/'),
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Section id="delete-h" title={t('data.delete.title')} scope="account">
      <p>{t('data.delete.intro')}</p>
      <p className="hint">{t('data.delete.ringsNote')}</p>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); void confirm({ message: t('data.delete.confirm'), confirmLabel: t('confirm.deleteAccount'), danger: true }).then((ok) => ok && del.mutate()); }}>
        <fieldset>
          <legend>{t('data.delete.postsLegend')}</legend>
          <label className="check"><input type="radio" name="posts" checked={posts === 'keep'} onChange={() => setPosts('keep')} />{t('data.delete.postsKeep')}</label>
          <label className="check"><input type="radio" name="posts" checked={posts === 'erase'} onChange={() => setPosts('erase')} />{t('data.delete.postsErase')}</label>
        </fieldset>
        <TextField label={t('data.delete.handle')} value={f.handle} onChange={(v) => setF((x) => ({ ...x, handle: v }))} autoCapitalize="none" spellCheck={false} required />
        <TextField label={t('data.delete.password')} type="password" autoComplete="current-password" value={f.password} onChange={(v) => setF((x) => ({ ...x, password: v }))} required />
        {me.totp_enabled && <TextField label={t('data.delete.code')} value={f.code} onChange={(v) => setF((x) => ({ ...x, code: v }))} autoComplete="one-time-code" required />}
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-danger" type="submit" disabled={del.isPending}>{t('data.delete.go')}</button>
      </form>
    </Section>
  );
}
