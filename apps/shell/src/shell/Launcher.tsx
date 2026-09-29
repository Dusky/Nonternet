import { Link } from 'react-router-dom';
import type { Me } from '@app/shared';
import { useT } from '../hooks';
import { visibleApps } from './apps';
import { AppIcon } from './icons';

// The phone home screen: a grid of apps, each opening full screen at its own address.
export function Launcher({ me }: { me: Me }) {
  const t = useT();
  return (
    <nav className="launcher" aria-label={t('nav.apps')}>
      <ul>
        {visibleApps(me).map((app) => (
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
