import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppPermission, CatalogApp } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { toast } from '../../components/feedback';
import { Alert, EmptyState, Loading } from '../../components/ui';
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
  const add = useMutation({
    mutationFn: (a: CatalogApp) => api.put(`/me/apps/${a.id}`, {}),
    onMutate: (a) => patch(a.id, { installed: true }),
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
              <p className="row-meta">{permissionsText(a.permissions, t)}</p>
            </div>
            <div className="app-card-actions">
              {a.installed ? (
                <>
                  <OpenAppLink app={appKey(a.id)} to="" className="btn btn-primary" aria-label={t('apps.openLabel', { app: a.name })}>{t('apps.open')}</OpenAppLink>
                  <button type="button" className="btn" onClick={() => remove.mutate(a)} aria-label={t('apps.removeLabel', { app: a.name })}>{t('apps.remove')}</button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => add.mutate(a)} aria-label={t('apps.addLabel', { app: a.name })}>{t('apps.add')}</button>
              )}
              {!a.installed && a.has_data && (
                <button type="button" className="btn btn-quiet btn-danger" onClick={() => deleteData(a)} aria-label={t('apps.deleteDataLabel', { app: a.name })}>{t('apps.deleteData')}</button>
              )}
            </div>
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
