import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { DesktopShortcut, Me } from '@app/shared';
import { useSite, useT } from '../hooks';
import { appById, appName, useVisibleApps, type AppDef } from './apps';
import { HomePanel } from './HomePanel';
import { AppBadge, useAppLabel } from '../components/AppBadge';
import { AppTile } from './icons';
import { shownApps, useDesktopLayout } from './desktopLayout';
import { shortcutKey } from './desktopLayout.logic';
import { useShortcutView } from './ShortcutIcon';
import type { AppId } from './windows';

// The phone home screen: what's new first, then a grid of apps, each opening full screen at its own address.
export function Launcher({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  useEffect(() => { void useDesktopLayout.getState().load(); }, []);
  const settings = useDesktopLayout((s) => s.settings);
  const visible = useVisibleApps(me, site);
  const available = new Set<string>(visible.map((a) => a.id));
  // Apps and shortcuts in one list, in the order this person chose for the phone.
  const items = shownApps([
    ...visible.map((app) => ({ id: app.id as string, app, sc: null as DesktopShortcut | null })),
    ...settings.shortcuts.map((sc) => ({ id: shortcutKey(sc.id), app: null as AppDef | null, sc })),
  ], settings, true);
  return (
    <div className="launcher">
      <HomePanel me={me} />
      <nav className="launcher-apps" aria-labelledby="launcher-apps">
        <h2 id="launcher-apps">{t('nav.apps')}</h2>
        <ul>
          {items.map((it) => (
            <li key={it.id}>{it.app ? <LauncherIcon app={it.app} /> : <LauncherShortcut sc={it.sc!} available={available} />}</li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function LauncherIcon({ app }: { app: AppDef }) {
  const t = useT();
  const title = appName(app, t);
  const named = useAppLabel(app.id, title);
  return (
    <Link to={app.path} className="icon" aria-label={named}>
      <AppTile id={app.id} /><AppBadge id={app.id} />
      <span className="icon-label">{title}</span>
    </Link>
  );
}

function LauncherShortcut({ sc, available }: { sc: DesktopShortcut; available: Set<string> }) {
  const t = useT();
  const view = useShortcutView(sc, available);
  const inner = <>{view.tile}<span className="icon-label">{sc.label}</span></>;
  const name = view.missing ? t('desktop.shortcut.missing', { label: sc.label }) : t('desktop.shortcut.open', { label: sc.label });
  if (view.missing) return <span className="icon is-shortcut is-missing" role="img" aria-label={name} title={t('desktop.shortcut.missingNote')}>{inner}</span>;
  if (sc.target.type === 'bookmark') return <a href={view.url ?? '#'} target="_blank" rel="noopener noreferrer" className="icon is-shortcut" aria-label={name}>{inner}</a>;
  const app = appById(sc.target.app as AppId);
  const to = `${app?.path ?? '/'}${sc.target.path ? `/${sc.target.path}` : ''}`;
  return <Link to={to} className="icon is-shortcut" aria-label={name}>{inner}</Link>;
}
