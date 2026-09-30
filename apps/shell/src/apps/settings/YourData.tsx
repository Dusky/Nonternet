import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

interface ExportRow { id: string; status: 'queued' | 'running' | 'ready' | 'failed' | 'expired'; requested_at: string; ready_at: string | null; expires_at: string | null; size_bytes: number | null; includes_private_key: boolean; error: string | null }
const size = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function YourData({ me }: { me: Me }) {
  return <><ExportSection /><DeleteSection me={me} /></>;
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
    <section className="panel" aria-labelledby="export-h">
      <h2 id="export-h">{t('data.export.title')}</h2>
      <p>{t('data.export.intro')}</p>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); ask.mutate(); }}>
        <TextField label={t('data.export.password')} hint={t('data.export.passwordHint')} type="password" autoComplete="current-password" value={password} onChange={setPassword} required />
        <label className="check"><input type="checkbox" checked={key} onChange={(e) => setKey(e.target.checked)} />{t('data.export.includeKey')}</label>
        {error && <Alert kind="error">{error}</Alert>}
        {note && <Alert kind="success">{note}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={ask.isPending}>{t('data.export.request')}</button>
      </form>
      <h3>{t('data.export.list')}</h3>
      {list.data?.exports.length === 0 && <p>{t('data.export.none')}</p>}
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
    </section>
  );
}

function DeleteSection({ me }: { me: Me }) {
  const t = useT();
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
    <section className="panel" aria-labelledby="delete-h">
      <h2 id="delete-h">{t('data.delete.title')}</h2>
      <p>{t('data.delete.intro')}</p>
      <p className="hint">{t('data.delete.ringsNote')}</p>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); if (window.confirm(t('data.delete.confirm'))) del.mutate(); }}>
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
    </section>
  );
}
