import { Link } from 'react-router-dom';
import type { Me } from '@app/shared';
import { useSite, useT } from '../hooks';
import { visibleApps } from './apps';
import { AppIcon } from './icons';

// The phone home screen: a grid of apps, each opening full screen at its own address.
export function Launcher({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  return (
    <nav className="launcher" aria-label={t('nav.apps')}>
      <ul>
        {visibleApps(me, site).map((app) => (
          <li key={app.id}>
            <Link to={app.path} className="icon">
              <AppIcon id={app.id} />
              <span>{t(app.title)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
