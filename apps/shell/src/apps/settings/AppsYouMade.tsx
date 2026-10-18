import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APP_PACKAGE_MAX_BYTES, type AuthoredApp, type CatalogApp } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { useConfirm, toast } from '../../components/feedback';
import { Alert } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { useNavigate } from 'react-router-dom';
import { appById } from '../../shell/apps';
import { appKey, useInstalled } from '../../shell/installed';
import { useIsDesktop } from '../../hooks';
import { useWindows } from '../../shell/windows';
import { Section } from './Section';

// Apps you made (docs/10): trusted people send a zip of their built app. It is theirs alone to try until an admin
// approves it; each new version waits for review while the approved one stays live.
export function AppsYouMade() {
  const t = useT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['apps', 'authored'], queryFn: () => api.get<{ apps: AuthoredApp[] }>('/me/apps-authored') });
  const refresh = async () => {
    void qc.invalidateQueries({ queryKey: ['apps'] });
    useInstalled.getState().set((await api.get<{ apps: CatalogApp[] }>('/me/apps')).apps);
  };
  const send = useMutation({
    mutationFn: (f: File) => api.upload<{ app: AuthoredApp }>('/me/apps-authored', f, 'POST'),
    onSuccess: (r) => { setError(null); toast(t('settings.made.sent', { app: r.app.name })); void refresh(); },
    onError: (e) => setError(errorText(e)),
    onSettled: () => { if (file.current) file.current.value = ''; },
  });
  const tryIt = useMutation({
    mutationFn: (a: AuthoredApp) => api.put<{ app: CatalogApp }>(`/me/apps/${a.id}`, {}),
    onSuccess: async (r) => {
      await refresh();
      const id = appKey(r.app.id);
      if (desktop) { useWindows.getState().open(id, ''); navigate('/'); } else navigate(appById(id).path);
    },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const withdraw = useMutation({
    mutationFn: (a: AuthoredApp) => api.del(`/me/apps-authored/${a.id}`),
    onSuccess: (_r, a) => { toast(t('settings.made.withdrawn', { app: a.name })); void refresh(); },
    onError: (e) => toast(errorText(e), 'error'),
  });

  return (
    <Section id="settings-made" title={t('settings.made.title')} intro={t('settings.made.intro')}>
      <div className="field">
        <label htmlFor="app-zip">{t('settings.made.choose')}</label>
        <input id="app-zip" ref={file} type="file" accept=".zip,application/zip" disabled={send.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > APP_PACKAGE_MAX_BYTES) { setError(t('settings.made.tooBig')); e.target.value = ''; return; }
            send.mutate(f);
          }} />
        <p className="hint">{t('settings.made.hint')}</p>
      </div>
      {send.isPending && <p role="status">{t('settings.made.sending')}</p>}
      {error && <Alert kind="error">{error}</Alert>}
      {q.data && (q.data.apps.length === 0 ? <p>{t('settings.made.none')}</p> : (
        <ul className="made-apps">
          {q.data.apps.map((a) => {
            const waiting = a.versions.find((v) => v.status === 'pending');
            return (
              <li key={a.id} className="panel">
                <h3>{a.name} <span className="muted">{a.id}</span></h3>
                <p>{a.offered ? t('settings.made.live', { version: a.live_version ?? '', count: a.people }) : a.live_version ? t('settings.made.notOffered') : t('settings.made.notYet')}</p>
                <ol className="made-versions" aria-label={t('settings.made.versions', { app: a.name })}>
                  {a.versions.map((v) => (
                    <li key={v.version}>
                      <strong>{v.version}</strong> {t(`settings.made.status.${v.status}` as StringKey)} <span className="muted">{formatWhen(v.reviewed_at ?? v.submitted_at)}</span>
                      {v.reason && v.status === 'declined' && <p className="made-reason">{t('settings.made.reason', { reason: v.reason })}</p>}
                    </li>
                  ))}
                </ol>
                <div className="actions">
                  {(waiting || a.offered) && (
                    <button type="button" className="btn" disabled={tryIt.isPending} onClick={() => tryIt.mutate(a)}
                      aria-label={t(waiting ? 'settings.made.tryLabel' : 'settings.made.openLabel', { app: a.name })}>{waiting ? t('settings.made.try') : t('settings.made.open')}</button>
                  )}
                  {(a.offered || waiting) && (
                    <button type="button" className="btn btn-danger" disabled={withdraw.isPending} aria-label={t('settings.made.withdrawLabel', { app: a.name })}
                      onClick={() => void confirm({ message: t('settings.made.withdrawConfirm', { app: a.name }), confirmLabel: t('settings.made.withdraw'), danger: true }).then((ok) => ok && withdraw.mutate(a))}>
                      {t('settings.made.withdraw')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ))}
    </Section>
  );
}
