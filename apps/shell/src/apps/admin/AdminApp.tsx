import { useEffect } from 'react';
import { SideNav } from '../../components/ui';
import { useMe, useSite, useT } from '../../hooks';
import { matchRoute, useAppNav } from '../../nav';
import { VouchesPanel } from './VouchesPanel';
import { BbsPanel } from './BbsPanel';
import { AuditReplay, CommandConsole, StatsPanel } from './ConsoleDepth';
import { ReportQueue } from '../boards/ReportQueue';
import { AnnouncementsPanel, LegalPanel, SettingsPanel } from './ConfigPanels';
import { BackupsPanel, StatusPanel } from './StatusPanels';
import { UpdatesPanel } from './UpdatesPanel';
import { ApplicationsPanel, useApplications } from './ApplicationsPanel';
import { IrcPanel } from './IrcPanel';
import { MudPanel } from './MudPanel';
import { Audit } from './AuditPanel';
import { BoardsTable, HomepagesTable, RingsTable } from './ContentPanels';
import { Invites, UserPage, Users } from './UsersPanels';

const ROUTES = ['status', 'users', 'users/:id', 'invites', 'audit', 'reports', 'boards', 'rings', 'homepages', 'settings', 'announcements', 'legal', 'irc', 'mud', 'backups', 'vouches', 'stats', 'console', 'audit/replay/:type/:id', 'bbs', 'updates', 'applications'] as const;

export default function AdminApp() {
  const t = useT();
  const me = useMe().data;
  const site = useSite();
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  useEffect(() => { if (!route) nav.go('status', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useApplications(me?.role === 'admin').data?.applications.length ?? 0;
  if (me?.role !== 'admin') return <p className="pad">{t('admin.forbidden')}</p>;
  return (
    <SideNav label={t('app.admin')} groups={[
      { label: t('admin.group.site'), items: [
        { to: 'status', label: t('admin.tab.status') },
        { to: 'settings', label: t('admin.tab.config') },
        { to: 'announcements', label: t('admin.tab.announcements') },
        { to: 'legal', label: t('admin.tab.legal') },
        { to: 'backups', label: t('admin.tab.backups') },
        { to: 'updates', label: t('admin.tab.updates') },
      ] },
      { label: t('admin.group.people'), items: [
        { to: 'users', label: t('admin.tab.users') },
        ...(site.signup_mode === 'application' || waiting > 0 ? [{ to: 'applications', label: waiting ? t('admin.tab.applicationsWaiting', { count: waiting }) : t('admin.tab.applications') }] : []),
        { to: 'invites', label: t('admin.tab.invites') },
        { to: 'vouches', label: t('admin.tab.vouches') },
      ] },
      { label: t('admin.group.content'), items: [
        { to: 'reports', label: t('admin.tab.moderation') },
        { to: 'boards', label: t('admin.tab.boards') },
        { to: 'rings', label: t('admin.tab.rings') },
        { to: 'homepages', label: t('admin.tab.homepages') },
      ] },
      ...(site.services.irc || site.services.mud || site.services.bbs ? [{ label: t('admin.group.services'), items: [
        ...(site.services.irc ? [{ to: 'irc', label: t('admin.tab.irc') }] : []),
        ...(site.services.mud ? [{ to: 'mud', label: t('admin.tab.mud') }] : []),
        ...(site.services.bbs ? [{ to: 'bbs', label: t('admin.tab.bbs') }] : []),
      ] }] : []),
      { label: t('admin.group.records'), items: [
        { to: 'audit', label: t('admin.tab.audit') },
        { to: 'stats', label: t('admin.tab.stats') },
        { to: 'console', label: t('admin.tab.console') },
      ] },
    ]}>
      {route?.pattern === 'status' && <StatusPanel />}
      {route?.pattern === 'legal' && <LegalPanel />}
      {route?.pattern === 'irc' && <IrcPanel />}
      {route?.pattern === 'mud' && <MudPanel />}
      {route?.pattern === 'bbs' && <BbsPanel />}
      {route?.pattern === 'backups' && <BackupsPanel />}
      {route?.pattern === 'updates' && <UpdatesPanel />}
      {route?.pattern === 'users' && <Users />}
      {route?.pattern === 'users/:id' && <UserPage myId={me.id} id={route.params.id!} />}
      {route?.pattern === 'invites' && <Invites />}
      {route?.pattern === 'applications' && <ApplicationsPanel />}
      {route?.pattern === 'vouches' && <VouchesPanel />}
      {route?.pattern === 'reports' && <ReportQueue />}
      {route?.pattern === 'boards' && <BoardsTable />}
      {route?.pattern === 'rings' && <RingsTable />}
      {route?.pattern === 'homepages' && <HomepagesTable />}
      {route?.pattern === 'settings' && <SettingsPanel />}
      {route?.pattern === 'announcements' && <AnnouncementsPanel />}
      {route?.pattern === 'audit' && <Audit />}
      {route?.pattern === 'audit/replay/:type/:id' && <AuditReplay type={route.params.type!} id={route.params.id!} />}
      {route?.pattern === 'stats' && <StatsPanel />}
      {route?.pattern === 'console' && <CommandConsole />}
    </SideNav>
  );
}

