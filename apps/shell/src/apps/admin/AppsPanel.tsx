import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogApp } from '@app/shared';
import { api } from '../../api';
import { toast } from '../../components/feedback';
import { Alert, EmptyState, Loading } from '../../components/ui';
import { errorText, useT } from '../../hooks';

type AdminApp = CatalogApp & { present: boolean; people: number };

// Apps (docs/10): the packages in this site's apps folder. Offering one lets people add it; withdrawing hides it
// from everyone, and what people kept stays theirs (and in their exports). Both are in the audit log.
export function AppsPanel() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'apps'], queryFn: () => api.get<{ apps: AdminApp[] }>('/admin/apps') });
  // While a change is on its way the box shows it, set in the click itself (a controlled checkbox snaps back
  // otherwise) and kept whatever a background refresh says meanwhile. A refusal ends it, and the box shows
  // what the server has.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const set = useMutation({
    mutationFn: (v: { id: string; offered: boolean }) => api.put(`/admin/apps/${v.id}`, { offered: v.offered }),
    onError: (e) => toast(errorText(e), 'error'),
    onSettled: async (_d, _e, v) => {
      await qc.invalidateQueries({ queryKey: ['admin', 'apps'] });
      setPending(({ [v.id]: _done, ...rest }) => rest);
    },
  });
  const toggle = (id: string, offered: boolean) => { setPending((p) => ({ ...p, [id]: offered })); set.mutate({ id, offered }); };
  const shown = (a: AdminApp) => pending[a.id] ?? a.offered;
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading />;
  return (
    <section aria-labelledby="apps-h">
      <h2 id="apps-h">{t('admin.apps.title')}</h2>
      {q.data.apps.length === 0 ? <EmptyState icon="grid">{t('admin.apps.none')}</EmptyState> : (
        <table className="table">
          <thead><tr><th scope="col">{t('admin.apps.app')}</th><th scope="col">{t('admin.apps.version')}</th><th scope="col">{t('admin.apps.people')}</th><th scope="col">{t('admin.apps.offered')}</th></tr></thead>
          <tbody>
            {q.data.apps.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.name}</strong><br /><span className="row-meta">{a.description}</span>{!a.present && <><br /><span className="badge badge-warn">{t('admin.apps.missing')}</span></>}</td>
                <td>{a.version}</td>
                <td>{a.people}</td>
                <td>
                  <label className="check">
                    <input type="checkbox" checked={shown(a)} disabled={!a.present} onChange={(e) => toggle(a.id, e.target.checked)} />
                    {t('admin.apps.offerLabel', { app: a.name })}
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
