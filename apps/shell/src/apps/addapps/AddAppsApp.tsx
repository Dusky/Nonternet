import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REPORT_CATEGORIES, type AppPermission, type CatalogApp } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { toast } from '../../components/feedback';
import { Alert, EmptyState, Loading, TextField } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { appKey, useInstalled } from '../../shell/installed';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { useWindows } from '../../shell/windows';

// Add apps (docs/10): what the site offers, each with what it may do in plain words. Adding puts the app on the
// desktop, the launcher and the apps menu; removing takes it off and keeps what it kept, so adding it again
// brings it back. Deleting that is its own button, and can be undone for a moment.
export default function AddAppsApp() {
  const t = useT();
  const qc = useQueryClient();
  const setInstalled = useInstalled((s) => s.set);
  const q = useQuery({ queryKey: ['apps', 'catalog'], queryFn: () => api.get<{ apps: CatalogApp[] }>('/apps') });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['apps'] });
    const mine = await api.get<{ apps: CatalogApp[] }>('/me/apps');
    setInstalled(mine.apps);
  };
  // The list changes at once; the server catches up behind it.
  const patch = (id: string, change: Partial<CatalogApp>) => qc.setQueryData<{ apps: CatalogApp[] }>(['apps', 'catalog'], (d) => d && { apps: d.apps.map((a) => (a.id === id ? { ...a, ...change } : a)) });
  // Adding asks first what the app may do (decided 2026-10-16); it can be changed later in Settings.
  const [asking, setAsking] = useState<{ id: string; granted: AppPermission[] } | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (a: CatalogApp & { chosen?: AppPermission[] }) => api.put(`/me/apps/${a.id}`, { granted: a.chosen ?? a.granted }),
    onMutate: (a) => { setAsking(null); patch(a.id, { installed: true }); },
    onSuccess: (_d, a) => { toast(t('apps.added', { app: a.name })); },
    onError: (e, a) => { patch(a.id, { installed: false }); toast(errorText(e), 'error'); },
    onSettled: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (a: CatalogApp) => api.del(`/me/apps/${a.id}`),
    onMutate: (a) => { patch(a.id, { installed: false }); useWindows.getState().close(appKey(a.id)); },
    onSuccess: (_d, a) => { toast(t('apps.removed', { app: a.name }), 'ok', { undo: () => add.mutate(a) }); },
    onError: (e, a) => { patch(a.id, { installed: true }); toast(errorText(e), 'error'); },
    onSettled: () => void refresh(),
  });
  const wipe = useMutation({
    mutationFn: (a: CatalogApp) => api.del(`/me/apps/${a.id}/data`),
    onMutate: (a) => patch(a.id, { has_data: false }),
    onError: (e, a) => { patch(a.id, { has_data: true }); toast(errorText(e), 'error'); },
    onSettled: () => void refresh(),
  });
  // Deleting waits a few seconds for an Undo before it is sent.
  const deleteData = (a: CatalogApp) => {
    patch(a.id, { has_data: false });
    let undone = false;
    toast(t('apps.dataDeleting', { app: a.name }), 'ok', { undo: () => { undone = true; patch(a.id, { has_data: true }); } });
    setTimeout(() => { if (!undone) wipe.mutate(a); }, 6000);
  };
  const apps = q.data?.apps ?? [];

  return (
    <div className="app-content">
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.isPending && <Loading rows={2} />}
      {q.isSuccess && apps.length === 0 && <EmptyState icon="grid">{t('apps.none')}</EmptyState>}
      <ul className="rows app-catalog">
        {apps.map((a) => (
          <li key={a.id} className="panel app-card">
            <AppTileFor app={a} />
            <div className="app-card-body">
              <h2>{a.name}</h2>
              <p>{a.description}</p>
              {a.author && <p className="row-meta">{t('apps.madeBy', { handle: a.author })}</p>}
              <p className="row-meta">{a.permissions.length > 0 && <strong>{t('apps.canLead')} </strong>}{permissionsText(a.permissions, t)}</p>
            </div>
            <div className="app-card-actions">
              {a.installed ? (
                <>
                  <OpenAppLink app={appKey(a.id)} to="" className="btn btn-primary" aria-label={t('apps.openLabel', { app: a.name })}>{t('apps.open')}</OpenAppLink>
                  <button type="button" className="btn" onClick={() => remove.mutate(a)} aria-label={t('apps.removeLabel', { app: a.name })}>{t('apps.remove')}</button>
                </>
              ) : (
                asking?.id !== a.id && <button type="button" className="btn btn-primary" onClick={() => (a.permissions.length ? setAsking({ id: a.id, granted: [...a.permissions] }) : add.mutate({ ...a, chosen: [] }))} aria-label={t('apps.addLabel', { app: a.name })}>{t('apps.add')}</button>
              )}
              {a.author && reporting !== a.id && (
                <button type="button" className="btn btn-quiet" onClick={() => setReporting(a.id)} aria-label={t('apps.reportLabel', { app: a.name })}>{t('apps.report')}</button>
              )}
              {!a.installed && a.has_data && (
                <button type="button" className="btn btn-quiet btn-danger" onClick={() => deleteData(a)} aria-label={t('apps.deleteDataLabel', { app: a.name })}>{t('apps.deleteData')}</button>
              )}
            </div>
            {reporting === a.id && <ReportApp app={a} onDone={() => setReporting(null)} />}
            {asking?.id === a.id && (
              <fieldset className="app-consent">
                <legend>{t('apps.consent.title', { app: a.name })}</legend>
                {a.permissions.map((p) => (
                  <label key={p} className="check">
                    <input type="checkbox" checked={asking.granted.includes(p)}
                      onChange={(e) => setAsking({ id: a.id, granted: e.target.checked ? [...asking.granted, p] : asking.granted.filter((x) => x !== p) })} />
                    {t(`apps.perm.${p.replace(':', '_')}` as StringKey)}
                  </label>
                ))}
                <p className="hint">{t('apps.consent.later')}</p>
                <div className="actions">
                  <button type="button" className="btn btn-primary" onClick={() => add.mutate({ ...a, chosen: asking.granted })}>{t('apps.addLabel', { app: a.name })}</button>
                  <button type="button" className="btn btn-quiet" onClick={() => setAsking(null)}>{t('common.cancel')}</button>
                </div>
              </fieldset>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function permissionsText(perms: AppPermission[], t: (k: StringKey) => string): string {
  if (perms.length === 0) return t('apps.perm.none');
  return perms.map((p) => t(`apps.perm.${p.replace(':', '_')}` as StringKey)).join(' ');
}

// The catalog app's own icon, drawn like the built-in ones.
function AppTileFor({ app }: { app: CatalogApp }) {
  return (
    <span className="app-tile" data-sticker={app.sticker} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={26} height={26} focusable="false"><path d={app.icon} fill="currentColor" /></svg>
    </span>
  );
}

// Reporting an app made by someone on the site goes to the admins, who can withdraw it (docs/10).
function ReportApp({ app, onDone }: { app: CatalogApp; onDone: () => void }) {
  const t = useT();
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('spam');
  const [note, setNote] = useState('');
  const send = useMutation({ mutationFn: () => api.post(`/apps/${app.id}/report`, { category, note }) });
  if (send.isSuccess) return <p className="muted" role="status">{t('apps.reported')}</p>;
  return (
    <form className="panel" aria-label={t('apps.reportLabel', { app: app.name })} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div className="field">
        <label htmlFor={`acat-${app.id}`}>{t('boards.report.category')}</label>
        <select id={`acat-${app.id}`} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`boards.report.cat.${c}`)}</option>)}
        </select>
      </div>
      <TextField label={t('boards.report.note')} value={note} onChange={setNote} maxLength={500} multiline />
      {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={send.isPending}>{t('boards.report.send')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
