import { lazy, type ComponentType } from 'react';
import type { CatalogApp, Me, PublicSite } from '@app/shared';
import type { StringKey } from '@app/strings';
import { appKey, catalogIdOf, hostComponent, useInstalled } from './installed';
import type { AppId } from './windows';

export interface AppDef {
  id: AppId;
  title?: StringKey;       // built-in apps: a string key
  name?: string;           // added apps: the name from their manifest
  installed?: CatalogApp;  // added apps: what the catalog says about it
  path: string;            // the app's own full-page address (docs/10: every app has one)
  adminOnly: boolean;
  public?: boolean;        // readable without logging in (docs/05)
  service?: 'irc' | 'mud' | 'bbs'; // shown only when the site turns that service on
  live?: boolean;          // holds a connection open (chat, the MUD, the terminal, an added app's bridge): keeps running while minimized
  Component: ComponentType;
}

// Apps load on demand, so a phone only downloads what it opens.
export const APPS: AppDef[] = [
  { id: 'boards', title: 'app.boards', path: '/boards', adminOnly: false, public: true, Component: lazy(() => import('../apps/boards/BoardsApp')) },
  { id: 'rings', title: 'app.rings', path: '/rings', adminOnly: false, public: true, Component: lazy(() => import('../apps/rings/RingsApp')) },
  { id: 'people', title: 'app.people', path: '/people', adminOnly: false, public: true, Component: lazy(() => import('../apps/people/PeopleApp')) },
  { id: 'mail', title: 'app.mail', path: '/mail', adminOnly: false, Component: lazy(() => import('../apps/mail/MailApp')) },
  { id: 'files', title: 'app.files', path: '/files', adminOnly: false, public: true, Component: lazy(() => import('../apps/files/FilesApp')) },
  { id: 'chat', title: 'app.chat', path: '/chat', adminOnly: false, service: 'irc', live: true, Component: lazy(() => import('../apps/chat/ChatApp')) },
  { id: 'mud', title: 'app.mud', path: '/mud', adminOnly: false, service: 'mud', live: true, Component: lazy(() => import('../apps/mud/MudApp')) },
  { id: 'terminal', title: 'app.terminal', path: '/terminal', adminOnly: false, service: 'bbs', live: true, Component: lazy(() => import('../apps/terminal/TerminalApp')) },
  { id: 'homepages', title: 'app.homepages', path: '/homepages', adminOnly: false, public: true, Component: lazy(() => import('../apps/homepages/HomepagesApp')) },
  { id: 'studio', title: 'app.studio', path: '/studio', adminOnly: false, Component: lazy(() => import('../apps/studio/StudioApp')) },
  { id: 'addapps', title: 'app.addapps', path: '/add-apps', adminOnly: false, Component: lazy(() => import('../apps/addapps/AddAppsApp')) },
  { id: 'notifications', title: 'app.notifications', path: '/notifications', adminOnly: false, Component: lazy(() => import('../apps/notifications/NotificationsApp')) },
  { id: 'settings', title: 'app.settings', path: '/settings', adminOnly: false, Component: lazy(() => import('../apps/settings/SettingsApp')) },
  { id: 'admin', title: 'app.admin', path: '/admin', adminOnly: true, Component: lazy(() => import('../apps/admin/AdminApp')) },
];

// An added app runs in the app host: a sandboxed frame on the homes origin with the bridge (docs/15).
const AppHost = lazy(() => import('./AppHost'));
const defs = new Map<string, AppDef>();
export function installedDef(x: CatalogApp): AppDef {
  const key = `${x.id}@${x.version}`;
  let d = defs.get(key);
  if (!d) {
    d = { id: appKey(x.id), name: x.name, installed: x, path: `/apps/${x.id}`, adminOnly: false, live: true, Component: hostComponent(x.id, AppHost) };
    defs.set(key, d);
  }
  return d;
}

// The def for an added app's own page: the real one, or (before the list arrives, or if it isn't added) one
// whose host says so.
export const installedOrPlaceholder = (catalogId: string, x: CatalogApp | undefined): AppDef =>
  x ? installedDef(x) : { id: appKey(catalogId), name: catalogId, path: `/apps/${catalogId}`, adminOnly: false, live: true, Component: hostComponent(catalogId, AppHost) };

// Built-in apps, then the ones this person added. An added app that is no longer added (or offered) has no def.
export function appById(id: AppId): AppDef {
  const c = catalogIdOf(id);
  if (c) {
    const x = useInstalled.getState().apps.find((a) => a.id === c);
    return installedOrPlaceholder(c, x);
  }
  return APPS.find((a) => a.id === id)!;
}
export const visibleApps = (me: Me, site: PublicSite, installed: CatalogApp[] = useInstalled.getState().apps): AppDef[] => [
  ...APPS.filter((a) => (!a.adminOnly || me.role === 'admin') && (!a.service || site.services[a.service])),
  ...installed.map(installedDef),
];
// The same, and re-renders when someone adds or removes an app.
export function useVisibleApps(me: Me, site: PublicSite): AppDef[] {
  const installed = useInstalled((s) => s.apps);
  return visibleApps(me, site, installed);
}
// What to call an app on screen.
export const appName = (app: AppDef, t: (k: StringKey) => string): string => app.name ?? t(app.title!);
