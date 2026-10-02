import type { HomepageSummary } from '@app/shared';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, Loading, Tabs } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { matchRoute, useAppNav } from '../../nav';
import { Files } from './FilesTab';
import { Mine, fmt } from './shared';
import { Assets } from './AssetsTab';
import { Settings } from './SettingsTab';
import { Widgets } from './WidgetsTab';
import { GuestbookManager } from './GuestbookTab';
import { Domains } from './DomainsTab';

const ROUTES = ['files', 'assets', 'widgets', 'guestbook', 'domains', 'settings'] as const;

export default function StudioApp() {
  const t = useT();
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  useEffect(() => { if (!route) nav.go('files', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ['studio'], queryFn: () => api.get<Mine>('/homes/me') });
  if (q.isError) return <div className="app-content"><Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert></div>;
  if (!q.data) return <Loading />;
  const { homepage } = q.data;
  return (
    <div className="app">
      <Tabs label={t('app.studio')} items={[
        { to: 'files', label: t('studio.tab.files') },
        { to: 'assets', label: t('studio.tab.assets') },
        { to: 'widgets', label: t('studio.tab.widgets') },
        { to: 'guestbook', label: t('studio.tab.guestbook') },
        { to: 'domains', label: t('studio.tab.domains') },
        { to: 'settings', label: t('studio.tab.settings') },
      ]} />
      <div className="app-content">
        <Usage h={homepage} />
        {route?.pattern === 'files' && <Files mine={q.data} />}
        {route?.pattern === 'assets' && <Assets />}
        {route?.pattern === 'widgets' && <Widgets />}
        {route?.pattern === 'guestbook' && <GuestbookManager h={homepage} />}
        {route?.pattern === 'domains' && <Domains />}
        {route?.pattern === 'settings' && <Settings h={homepage} />}
      </div>
    </div>
  );
}

function Usage({ h }: { h: HomepageSummary }) {
  const t = useT();
  return (
    <div className="usage">
      <p>
        <a href={h.url} target="_blank" rel="noopener noreferrer">{t('studio.view')}</a>
        {' · '}<span className="muted">{h.last_updated_at ? t('studio.updated', { when: formatWhen(h.last_updated_at) ?? '' }) : t('studio.never')}</span>
      </p>
      <progress value={h.size_bytes} max={h.quota_bytes} aria-label={t('studio.usageLabel')} />
      <p className="hint">{t('studio.usage', { used: fmt(h.size_bytes), quota: fmt(h.quota_bytes) })}</p>
    </div>
  );
}
