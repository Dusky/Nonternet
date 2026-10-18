import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppReviewItem, CatalogApp } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { toast } from '../../components/feedback';
import { Alert, EmptyState, Loading, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import AppHost from '../../shell/AppHost';

type AdminApp = CatalogApp & { present: boolean; people: number; source: 'site' | 'submitted' };

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
    <>
    <ReviewQueue />
    <section aria-labelledby="apps-h">
      <h2 id="apps-h">{t('admin.apps.title')}</h2>
      {q.data.apps.length === 0 ? <EmptyState icon="grid">{t('admin.apps.none')}</EmptyState> : (
        <table className="table">
          <thead><tr><th scope="col">{t('admin.apps.app')}</th><th scope="col">{t('admin.apps.version')}</th><th scope="col">{t('admin.apps.people')}</th><th scope="col">{t('admin.apps.offered')}</th></tr></thead>
          <tbody>
            {q.data.apps.map((a) => (
              <tr key={a.id}>
                <td><strong>{a.name}</strong><br /><span className="row-meta">{a.description}</span>{a.author && <><br /><span className="row-meta">{t('apps.madeBy', { handle: a.author })}</span></>}{!a.present && <><br /><span className="badge badge-warn">{t('admin.apps.missing')}</span></>}</td>
                <td data-label={t('admin.apps.version')}>{a.version}</td>
                <td data-label={t('admin.apps.people')}>{a.people}</td>
                <td data-label={t('admin.apps.offered')}>
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
    </>
  );
}

// Apps trusted people sent, waiting for an admin (docs/10, 15). The review is the safety check: read what it asks to
// do, look at its files, try it in the sandbox with nothing allowed, then offer it or say why not.
function ReviewQueue() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'app-reviews'], queryFn: () => api.get<{ reviews: AppReviewItem[] }>('/admin/app-reviews') });
  if (!q.data) return null;
  return (
    <section aria-labelledby="app-reviews-h">
      <h2 id="app-reviews-h">{t('admin.apps.reviewTitle')}</h2>
      {q.data.reviews.length === 0 ? <p>{t('admin.apps.reviewNone')}</p> : (
        <ul className="rows">{q.data.reviews.map((r) => <ReviewCard key={`${r.id}@${r.version}`} item={r} />)}</ul>
      )}
    </section>
  );
}

function ReviewCard({ item }: { item: AppReviewItem }) {
  const t = useT();
  const qc = useQueryClient();
  const [previewing, setPreviewing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'decline') => api.post(`/admin/app-reviews/${item.id}/${item.version}`, { decision, reason }),
    onSuccess: (_d, decision) => { toast(t(decision === 'approve' ? 'admin.apps.approved' : 'admin.apps.declined', { app: item.name })); void qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const preview: CatalogApp = {
    id: item.id, name: item.name, version: item.version, description: item.description, icon: item.icon, sticker: item.sticker, permissions: item.permissions,
    granted: [], url: item.url, widget_url: item.widget_url, installed: false, offered: false, author: item.author,
  };
  return (
    <li className="panel app-review" aria-labelledby={`rev-${item.id}`}>
      <h3 id={`rev-${item.id}`}>{item.name} <span className="muted">{item.id}@{item.version}</span></h3>
      <p>{item.description}</p>
      <ul className="facts">
        <li>{t('apps.madeBy', { handle: item.author ?? '?' })}</li>
        <li>{t('admin.apps.sent', { when: formatWhen(item.submitted_at) ?? '' })}</li>
        <li>{item.live_version ? t('admin.apps.replaces', { version: item.live_version }) : t('admin.apps.firstVersion')}</li>
      </ul>
      <p><strong>{t('apps.canLead')} </strong>{item.permissions.length ? item.permissions.map((p) => t(`apps.perm.${p.replace(':', '_')}` as StringKey)).join(' ') : t('apps.perm.none')}</p>
      <details>
        <summary>{t('admin.apps.files', { count: item.files.length, size: Math.ceil(item.bytes / 1024) })}</summary>
        <ul className="mono-list">{item.files.map((f) => <li key={f.path}>{f.path} <span className="muted">{f.size}</span></li>)}</ul>
      </details>
      <div className="actions">
        <button type="button" className="btn" aria-expanded={previewing} onClick={() => setPreviewing((v) => !v)} aria-label={t('admin.apps.previewLabel', { app: item.name })}>
          {previewing ? t('admin.apps.previewClose') : t('admin.apps.preview')}
        </button>
        <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate('approve')} aria-label={t('admin.apps.approveLabel', { app: item.name })}>{t('admin.apps.approve')}</button>
        {!declining && <button type="button" className="btn btn-danger" onClick={() => setDeclining(true)} aria-label={t('admin.apps.declineLabel', { app: item.name })}>{t('admin.apps.decline')}</button>}
      </div>
      {previewing && <div className="app-review-preview"><p className="hint">{t('admin.apps.previewNote')}</p><AppHost appId={item.id} preview={preview} /></div>}
      {declining && (
        <form onSubmit={(e) => { e.preventDefault(); decide.mutate('decline'); }}>
          <TextField label={t('admin.apps.declineWhy')} value={reason} onChange={setReason} maxLength={1000} multiline />
          <div className="actions">
            <button type="submit" className="btn btn-danger" disabled={decide.isPending || reason.trim().length < 3}>{t('admin.apps.declineSend')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setDeclining(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </li>
  );
}
