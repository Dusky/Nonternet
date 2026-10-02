import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { CopyButton } from '../../components/ui';
import { AssetInfo } from './shared';

export function Assets() {
  const t = useT();
  const qc = useQueryClient();
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['studio', 'assets'], queryFn: () => api.get<{ assets: AssetInfo[] }>('/homes/assets') });
  const add = useMutation({
    mutationFn: (id: string) => api.post<{ path: string }>('/homes/me/assets', { id }),
    onSuccess: (r) => { setAdded(r.path); setError(null); void qc.invalidateQueries({ queryKey: ['studio'] }); }, onError: (e) => setError(errorText(e)),
  });
  return (
    <>
      <p>{t('studio.assets.hint')}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {added && <Alert kind="success">{t('studio.assets.added', { snippet: `<img src="${added}" alt="">` })} <CopyButton text={`<img src="${added}" alt="">`} label={t('studio.assets.copy')} /></Alert>}
      <ul className="cards asset-grid">
        {list.data?.assets.map((a) => (
          <li key={a.id} className="panel">
            <img src={`/api/v1/homes/assets/${a.id}`} alt="" width={a.width} height={a.height} className="asset-preview" />
            <p>{a.title}</p>
            <button type="button" className="btn" disabled={add.isPending} onClick={() => add.mutate(a.id)} aria-label={t('studio.assets.add', { name: a.title })}>{t('studio.assets.add', { name: a.title })}</button>
          </li>
        ))}
      </ul>
    </>
  );
}
