import type { HomepageSummary } from '@app/shared';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, EmptyState } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

interface GbRow { id: string; name: string; url: string | null; message: string; at: string; status: 'visible' | 'pending' | 'hidden'; member: string | null }

export function GuestbookManager({ h }: { h: HomepageSummary }) {
  const t = useT();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['studio', 'guestbook'], queryFn: () => api.get<{ entries: GbRow[] }>('/homes/me/guestbook') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['studio'] }); };
  const mode = useMutation({ mutationFn: (m: string) => api.patch('/homes/me', { guestbook_mode: m }), onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  const set = useMutation({ mutationFn: (v: { id: string; status: 'visible' | 'hidden' }) => api.patch(`/homes/me/guestbook/${v.id}`, { status: v.status }), onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  return (
    <>
      <div className="field">
        <label htmlFor="gb-mode">{t('studio.guestbook.mode')}</label>
        <select id="gb-mode" value={h.guestbook_mode} onChange={(e) => mode.mutate(e.target.value)}>
          {(['open', 'approval', 'off'] as const).map((m) => <option key={m} value={m}>{t(`studio.guestbook.mode.${m}`)}</option>)}
        </select>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <h2>{t('studio.guestbook.entries')}</h2>
      {list.data?.entries.length === 0 && <EmptyState>{t('studio.guestbook.none')}</EmptyState>}
      <ul className="rows">
        {list.data?.entries.map((e) => (
          <li key={e.id}>
            <strong>{e.name}</strong> <span className="badge">{t(`studio.guestbook.state.${e.status}`)}</span> <span className="muted">{formatWhen(e.at)}</span>
            <p className="post-body">{e.message}</p>
            {e.url && <p className="hint">{e.url}</p>}
            {e.status !== 'visible' && <button type="button" className="link" onClick={() => set.mutate({ id: e.id, status: 'visible' })}>{e.status === 'pending' ? t('studio.guestbook.approve') : t('studio.guestbook.show')}</button>}
            {e.status !== 'hidden' && <button type="button" className="link" onClick={() => set.mutate({ id: e.id, status: 'hidden' })}>{t('studio.guestbook.hide')}</button>}
          </li>
        ))}
      </ul>
    </>
  );
}
