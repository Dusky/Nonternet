import { useEffect } from 'react';
import type { Me } from '@app/shared';
import { useSite, useT } from '../hooks';
import { visibleApps } from './apps';
import { HomePanel } from './HomePanel';
import { AppTile } from './icons';
import { focusedWindow, useWindows } from './windows';
import { Window } from './Window';

// The desktop for big screens: an icon per app and the home panel, with the open windows on top.
export function Desktop({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  const { wins, open, setViewport } = useWindows();
  const top = focusedWindow(wins);

  useEffect(() => {
    const fit = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [setViewport]);

  return (
    <div className="desktop" aria-label={t('nav.desktop')}>
      <div className="desktop-layout">
        <ul className="icons" aria-label={t('nav.apps')}>
          {visibleApps(me, site).map((app) => (
            <li key={app.id}>
              <button type="button" className="icon" data-app-icon={app.id} onClick={() => open(app.id)} aria-label={t('app.openApp', { app: t(app.title) })}>
                <AppTile id={app.id} />
                <span>{t(app.title)}</span>
              </button>
            </li>
          ))}
        </ul>
        <HomePanel me={me} />
      </div>
      {wins.map((w) => <Window key={w.id} win={w} focused={top?.id === w.id} />)}
    </div>
  );
}
