import { useEffect } from 'react';
import type { Me } from '@app/shared';
import { useSite, useT } from '../hooks';
import { appById, visibleApps } from './apps';
import { HomePanel } from './HomePanel';
import { AppTile } from './icons';
import { focusedWindow, restoreSession, saveSession, snapGeometry, useWindows } from './windows';
import { Window } from './Window';
import { useContextMenu } from '../components/ContextMenu';
import type { AppDef } from './apps';

// The desktop for big screens: an icon per app and the home panel, with the open windows on top.
export function Desktop({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  const { wins, setViewport, snapPreview, viewport } = useWindows();
  const top = focusedWindow(wins);

  useEffect(() => {
    const fit = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [setViewport]);

  // Reopen what was open last time, and keep remembering as windows come and go.
  useEffect(() => {
    const allowed = new Set(visibleApps(me, site).map((a) => a.id));
    restoreSession(me.id, (id) => allowed.has(id) && Boolean(appById(id)));
    return useWindows.subscribe(() => saveSession(me.id));
  }, [me, site]);

  return (
    <div className="desktop" aria-label={t('nav.desktop')}>
      <div className="desktop-layout">
        <ul className="icons" aria-label={t('nav.apps')}>
          {visibleApps(me, site).map((app) => (
            <li key={app.id}><DesktopIcon app={app} /></li>
          ))}
        </ul>
        <HomePanel me={me} />
      </div>
      {snapPreview && <div className="snap-preview" aria-hidden="true" style={{ left: snapGeometry(snapPreview, viewport).x, top: snapGeometry(snapPreview, viewport).y, width: snapGeometry(snapPreview, viewport).w, height: snapGeometry(snapPreview, viewport).h }} />}
      {wins.map((w) => <Window key={w.id} win={w} focused={top?.id === w.id} />)}
    </div>
  );
}

// An app on the desktop. Right-click (or Shift+F10) offers opening it here or on a page of its own.
function DesktopIcon({ app }: { app: AppDef }) {
  const t = useT();
  const open = useWindows((s) => s.open);
  const title = t(app.title);
  const ctx = useContextMenu(() => [
    { label: t('app.openApp', { app: title }), onSelect: () => open(app.id) },
    { label: t('ctx.openPage'), onSelect: () => window.open(app.path, '_blank', 'noopener') },
  ]);
  return (
    <>
      <button type="button" className="icon" data-app-icon={app.id} onClick={() => open(app.id)} aria-label={t('app.openApp', { app: title })} {...ctx.bind}>
        <AppTile id={app.id} />
        <span>{title}</span>
      </button>
      {ctx.menu}
    </>
  );
}
