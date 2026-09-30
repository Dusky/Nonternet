import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Me, PublicSite } from '@app/shared';
import type { StringKey } from '@app/strings';
import type { AppId } from './windows';

export interface AppDef {
  id: AppId;
  title: StringKey;
  path: string;            // the app's own full-page address (docs/10: every app has one)
  adminOnly: boolean;
  public?: boolean;        // readable without logging in (docs/05)
  service?: 'irc' | 'mud'; // shown only when the site turns that service on
  Component: LazyExoticComponent<ComponentType>;
}

// Apps load on demand, so a phone only downloads what it opens.
export const APPS: AppDef[] = [
  { id: 'boards', title: 'app.boards', path: '/boards', adminOnly: false, public: true, Component: lazy(() => import('../apps/boards/BoardsApp')) },
  { id: 'rings', title: 'app.rings', path: '/rings', adminOnly: false, public: true, Component: lazy(() => import('../apps/rings/RingsApp')) },
  { id: 'people', title: 'app.people', path: '/people', adminOnly: false, public: true, Component: lazy(() => import('../apps/people/PeopleApp')) },
  { id: 'chat', title: 'app.chat', path: '/chat', adminOnly: false, service: 'irc', Component: lazy(() => import('../apps/chat/ChatApp')) },
  { id: 'mud', title: 'app.mud', path: '/mud', adminOnly: false, service: 'mud', Component: lazy(() => import('../apps/mud/MudApp')) },
  { id: 'homepages', title: 'app.homepages', path: '/homepages', adminOnly: false, public: true, Component: lazy(() => import('../apps/homepages/HomepagesApp')) },
  { id: 'studio', title: 'app.studio', path: '/studio', adminOnly: false, Component: lazy(() => import('../apps/studio/StudioApp')) },
  { id: 'notifications', title: 'app.notifications', path: '/notifications', adminOnly: false, Component: lazy(() => import('../apps/notifications/NotificationsApp')) },
  { id: 'settings', title: 'app.settings', path: '/settings', adminOnly: false, Component: lazy(() => import('../apps/settings/SettingsApp')) },
  { id: 'admin', title: 'app.admin', path: '/admin', adminOnly: true, Component: lazy(() => import('../apps/admin/AdminApp')) },
];

export const appById = (id: AppId): AppDef => APPS.find((a) => a.id === id)!;
export const visibleApps = (me: Me, site: PublicSite): AppDef[] => APPS.filter((a) => (!a.adminOnly || me.role === 'admin') && (!a.service || site.services[a.service]));
