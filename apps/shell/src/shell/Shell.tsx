import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '@app/shared';
import { api } from '../api';
import { useIsDesktop, useSite, useT } from '../hooks';
import { appById, visibleApps } from './apps';
import { AppIcon } from './icons';
import { focusedWindow, useWindows } from './windows';

// The frame around everything once you are signed in: the taskbar (site name, apps, open windows,
// account menu) and the page. On a phone it is a plain top bar with a way back.
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const t = useT();
  const site = useSite();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const location = useLocation();
  const { wins, open, focus, minimize } = useWindows();
  const top = focusedWindow(wins);
  const [menu, setMenu] = useState<'apps' | 'account' | null>(null);
  const bar = useRef<HTMLElement>(null);

  // Escape and clicking elsewhere close a menu, as people expect.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const onClick = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [menu]);
  useEffect(() => setMenu(null), [location.pathname]);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    // A full page load, not a client-side hop: nothing from this person's session (an admin's cached
    // user list, open windows) stays in memory for the next person at this screen.
    window.location.assign('/');
  };
  const launch = (id: 'settings' | 'admin') => {
    setMenu(null);
    if (desktop) { open(id); navigate('/'); } else navigate(appById(id).path);
  };

  const onHome = location.pathname === '/';
  return (
    <div className="shell">
      <a className="skip" href="#main">{t('nav.skip')}</a>
      <header className="taskbar" ref={bar}>
        {!desktop && !onHome && <Link className="back" to="/" aria-label={t('nav.back')}>&#8592;</Link>}
        <Link className="brand" to="/">{site.name}</Link>

        {desktop && (
          <div className="taskbar-apps">
            <button type="button" className="btn btn-quiet" aria-haspopup="menu" aria-expanded={menu === 'apps'} onClick={() => setMenu(menu === 'apps' ? null : 'apps')}>{t('nav.apps')}</button>
            {menu === 'apps' && (
              <ul className="menu" role="menu">
                {visibleApps(me).map((a) => (
                  <li key={a.id} role="none"><button type="button" role="menuitem" onClick={() => launch(a.id)}><AppIcon id={a.id} /> {t(a.title)}</button></li>
                ))}
              </ul>
            )}
            <ul className="taskbar-windows" aria-label={t('nav.openWindows')}>
              {wins.map((w) => (
                <li key={w.id}>
                  <button
                    type="button" className={`btn btn-quiet${top?.id === w.id ? ' is-active' : ''}`}
                    aria-label={t('window.focus', { app: t(appById(w.id).title) })}
                    aria-pressed={top?.id === w.id}
                    onClick={() => (top?.id === w.id ? minimize(w.id) : focus(w.id))}
                  >{t(appById(w.id).title)}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="taskbar-account">
          <button type="button" className="btn btn-quiet" aria-haspopup="menu" aria-expanded={menu === 'account'} aria-label={t('nav.account', { handle: me.handle })} onClick={() => setMenu(menu === 'account' ? null : 'account')}>{me.handle}</button>
          {menu === 'account' && (
            <ul className="menu menu-right" role="menu">
              <li role="none"><button type="button" role="menuitem" onClick={() => launch('settings')}>{t('app.settings')}</button></li>
              <li role="none"><button type="button" role="menuitem" onClick={() => void logout()}>{t('nav.logout')}</button></li>
            </ul>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="stage">{children}</main>
    </div>
  );
}
