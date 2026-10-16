import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppPermission, CatalogApp } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { toast } from '../../components/feedback';
import { errorText, useT } from '../../hooks';
import { useInstalled } from '../../shell/installed';
import { Section } from './Section';

// What each app you added may do (docs/10): chosen when adding it, changed here at any time. An app that asks for something
// new in a later version gets it only once it is switched on here.
export function AppPermissions() {
  const t = useT();
  const qc = useQueryClient();
  const setInstalled = useInstalled((s) => s.set);
  const q = useQuery({ queryKey: ['apps', 'mine'], queryFn: () => api.get<{ apps: CatalogApp[] }>('/me/apps') });
  // The switch moves at once from here; the server's answer takes over when it comes, and a refusal puts it back.
  const [pending, setPending] = useState<Record<string, AppPermission[]>>({});
  const change = useMutation({
    mutationFn: (v: { app: CatalogApp; granted: AppPermission[] }) => api.put<{ app: CatalogApp }>(`/me/apps/${v.app.id}/permissions`, { granted: v.granted }),
    onSettled: async (_d, _e, v) => {
      const mine = await api.get<{ apps: CatalogApp[] }>('/me/apps');
      qc.setQueryData(['apps', 'mine'], mine);
      setPending(({ [v.app.id]: _done, ...rest }) => rest);
      setInstalled(mine.apps);
      void qc.invalidateQueries({ queryKey: ['apps', 'catalog'] });
    },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const apps = (q.data?.apps ?? []).filter((a) => a.permissions.length > 0);
  if (!q.isSuccess || apps.length === 0) return null;
  return (
    <Section id="settings-apps" title={t('settings.apps.title')} intro={t('settings.apps.intro')}>
      {apps.map((a) => ({ ...a, granted: pending[a.id] ?? a.granted })).map((a) => (
        <fieldset key={a.id} className="app-consent">
          <legend>{a.name}</legend>
          {a.permissions.map((p) => (
            <label key={p} className="check switch">
              <input type="checkbox" role="switch" checked={a.granted.includes(p)}
                onChange={(e) => {
                  const granted = e.target.checked ? [...a.granted, p] : a.granted.filter((x) => x !== p);
                  setPending((all) => ({ ...all, [a.id]: granted }));
                  change.mutate({ app: a, granted });
                }} />
              {t(`apps.perm.${p.replace(':', '_')}` as StringKey)}
            </label>
          ))}
        </fieldset>
      ))}
    </Section>
  );
}
