import { Link } from 'react-router-dom';
import type { Me } from '@app/shared';
import { useSite, useT } from '../hooks';
import { appName, useVisibleApps, type AppDef } from './apps';
import { HomePanel } from './HomePanel';
import { AppBadge, useAppLabel } from '../components/AppBadge';
import { AppTile } from './icons';

// The phone home screen: what's new first, then a grid of apps, each opening full screen at its own address.
export function Launcher({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  return (
    <div className="launcher">
      <HomePanel me={me} />
      <nav className="launcher-apps" aria-labelledby="launcher-apps">
        <h2 id="launcher-apps">{t('nav.apps')}</h2>
        <ul>
          {useVisibleApps(me, site).map((app) => (
            <li key={app.id}><LauncherIcon app={app} /></li>
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
