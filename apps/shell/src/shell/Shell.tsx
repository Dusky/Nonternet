import { clearAllDrafts } from '../drafts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Me } from '@app/shared';
import { api } from '../api';
import { AnnouncementBanner } from '../components/Announcements';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/ui';
import { useIsDesktop, useSite, useT } from '../hooks';
import { arrive } from '../alerts';
import { pollMs, useLive, useLiveEvents } from '../live';
import { clockPref } from '../theme';
import { APPS, appById, visibleApps } from './apps';
import { CommandPalette } from './CommandPalette';
import type { OnlinePerson } from './HomePanel';
import { AppIcon, AppTile } from './icons';
import { ShortcutsSheet } from './ShortcutsSheet';
import { StatusBanners } from './StatusBanners';
import { useContextMenu } from '../components/ContextMenu';
import { useMenuKeys } from './menuKeys';
import { setFavicon, tabTitle } from './tabInfo';
import { clearSession, focusedWindow, useWindows, type AppId, type Win } from './windows';

const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || Boolean(el.closest('.xterm')));

// The frame around everything once you are signed in. On a big screen: the taskbar (site name, apps,
// open windows, who's online, the time, mail, notifications, account). On a phone: a top bar with a
// way back, and a tab bar along the bottom for the places people go most.
// Keys: Ctrl+K (Cmd+K) opens the search-and-jump palette; Alt+` brings the next window forward.
export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  const t = useT();
  const site = useSite();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const location = useLocation();
  const { wins, open, cycle } = useWindows();
  const top = focusedWindow(wins);
  const [menu, setMenu] = useState<'apps' | 'account' | null>(null);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const appsButton = useRef<HTMLButtonElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const appsMenu = useRef<HTMLUListElement>(null);
  const accountMenu = useRef<HTMLUListElement>(null);
  const confirmed = me.role !== 'guest';
  // Something arrived while the tab is in the background: a chime and/or a desktop notification, if turned on.
  useLiveEvents(me.id, (type) => arrive(
    { title: site.name, body: t(type === 'mail' ? 'alerts.newMail' : 'alerts.newNotification'), tag: `arrival-${type}` },
    () => launch(type === 'mail' ? 'mail' : 'notifications'),
  ));
  const poll = pollMs(useLive((l) => l.status));
  // Numbers on the mail and notification buttons: pushed by the live stream, with a slow check as a safety net
  // (every minute when the stream is down).
  const unreadMail = useQuery({ queryKey: ['mail', 'unread', me.id], queryFn: () => api.get<{ unread: number }>('/mail/unread'), refetchInterval: poll, staleTime: 15_000, enabled: confirmed }).data?.unread ?? 0;
  const unread = useQuery({ queryKey: ['notifications', 'count', me.id], queryFn: () => api.get<{ unread: number }>('/notifications/count'), refetchInterval: poll, staleTime: 15_000 }).data?.unread ?? 0;
  const online = useQuery({ queryKey: ['online'], queryFn: () => api.get<{ people: OnlinePerson[] }>('/online'), refetchInterval: 60_000, enabled: confirmed && desktop }).data?.people;

  // The tab says where you are and what is waiting.
  // On the desktop screen it is the window in front; on a page of an app's own (a phone, or a link) it is that app.
  const byPath = APPS.find((a) => location.pathname === a.path || location.pathname.startsWith(`${a.path}/`)) ?? null;
  const appHere = desktop && location.pathname === '/' ? (top ? appById(top.id) : null) : byPath;
  const waiting = unreadMail + unread;
  const subtitle = useWindows((w) => (appHere ? w.subtitles[appHere.id] : undefined));
  useEffect(() => {
    const where = appHere ? [t(appHere.title), subtitle].filter(Boolean).join(' — ') : null;
    document.title = tabTitle({ site: site.name, app: where, unread: waiting });
    setFavicon(waiting > 0);
  }, [site.name, appHere?.id, subtitle, waiting, t]); // eslint-disable-line react-hooks/exhaustive-deps

  useMenuKeys(appsMenu, menu === 'apps', () => setMenu(null), appsButton);
  useMenuKeys(accountMenu, menu === 'account', () => setMenu(null), accountButton);

  // Clicking elsewhere closes a menu, as people expect.
  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menu]);
  useEffect(() => setMenu(null), [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !editable(e.target)) { e.preventDefault(); setShortcuts(true); return; }
      if (desktop && e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'Backquote' && !editable(e.target)) {
        e.preventDefault();
        if (cycle()) setTimeout(() => document.querySelector<HTMLElement>('.window.is-focused .window-title')?.focus(), 0);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desktop, cycle]);

  const logout = async () => {
    clearSession(); clearAllDrafts(); // the next person at this screen starts with a clean desktop
    await api.post('/auth/logout').catch(() => undefined);
    // A full page load, not a client-side hop: nothing from this person's session (an admin's cached
    // user list, open windows) stays in memory for the next person at this screen.
    window.location.assign('/');
  };
  const launch = (id: AppId, path?: string) => {
    setMenu(null);
    if (desktop) { open(id, path); navigate('/'); } else navigate(`${appById(id).path}${path ? `/${path}` : ''}`);
  };

  const onHome = location.pathname === '/';
  const apps = visibleApps(me, site);
  return (
    <div className="shell">
      <a className="skip" href="#main">{t('nav.skip')}</a>
      <div className="shell-top">
      <header className="taskbar" ref={bar}>
        {!desktop && !onHome && <Link className="back" to="/" aria-label={t('nav.back')}><Icon name="back" /></Link>}
        <Link className="brand" to="/"><span className="brand-mark" aria-hidden="true" />{site.name}</Link>

        {desktop && (
          <div className="taskbar-apps">
            <button ref={appsButton} type="button" className="btn btn-quiet" aria-haspopup="menu" aria-expanded={menu === 'apps'} onClick={() => setMenu(menu === 'apps' ? null : 'apps')}><Icon name="grid" />{t('nav.apps')}</button>
            {menu === 'apps' && (
              <ul ref={appsMenu} className="menu menu-grid" role="menu" aria-label={t('nav.apps')}>
                {apps.map((a) => (
                  <li key={a.id} role="none"><button type="button" role="menuitem" onClick={() => launch(a.id)}><AppTile id={a.id} /> {t(a.title)}</button></li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-quiet btn-icon" onClick={() => setPalette(true)} aria-label={t('palette.open')} aria-keyshortcuts="Control+K Meta+K" title={`${t('palette.open')} (Ctrl+K)`}><Icon name="search" /></button>
            <ul className="taskbar-windows" aria-label={t('nav.openWindows')}>
              {wins.map((w) => <li key={w.id}><TaskbarWindow win={w} front={top?.id === w.id} /></li>)}
            </ul>
          </div>
        )}

        <div className="taskbar-account">
          {desktop && (
            <span className="taskbar-status">
              {online && (
                <button type="button" className="btn btn-quiet btn-small" onClick={() => launch('people')} aria-label={t('taskbar.onlineLabel', { count: online.length })}>
                  <span className="online-dot" aria-hidden="true" />{t('taskbar.online', { count: online.length })}
                </button>
              )}
              <Clock />
            </span>
          )}
          {confirmed && (
            <button type="button" className="btn btn-quiet bell" onClick={() => launch('mail')}
              aria-label={unreadMail > 0 ? t('mail.bellCount', { count: unreadMail }) : t('mail.bell')}>
              <AppIcon id="mail" size={22} />
              {unreadMail > 0 && <span className="badge" aria-hidden="true">{unreadMail > 99 ? t('common.lots') : unreadMail}</span>}
            </button>
          )}
          <button type="button" className="btn btn-quiet bell" onClick={() => launch('notifications')}
            aria-label={unread > 0 ? t('notifications.bellCount', { count: unread }) : t('notifications.bell')}>
            <AppIcon id="notifications" size={22} />
            {unread > 0 && <span className="badge" aria-hidden="true">{unread > 99 ? t('common.lots') : unread}</span>}
          </button>
          <button ref={accountButton} type="button" className="btn btn-quiet person" aria-haspopup="menu" aria-expanded={menu === 'account'} aria-label={t('nav.account', { handle: me.handle })} onClick={() => setMenu(menu === 'account' ? null : 'account')}>
            <Avatar id={me.id} name={me.display_name || me.handle} size="sm" />{desktop && me.handle}
          </button>
          {menu === 'account' && (
            <ul ref={accountMenu} className="menu menu-right" role="menu" aria-label={t('nav.account', { handle: me.handle })}>
              <li role="none"><button type="button" role="menuitem" onClick={() => launch('people', me.handle)}><Icon name="user" />{t('nav.profile')}</button></li>
              <li role="none"><button type="button" role="menuitem" onClick={() => launch('settings')}><AppIcon id="settings" size={22} />{t('app.settings')}</button></li>
              <li role="none"><button type="button" role="menuitem" onClick={() => { setMenu(null); setShortcuts(true); }}>{t('shortcuts.menuItem')}</button></li>
              <li role="none" className="menu-sep" />
              <li role="none"><button type="button" role="menuitem" onClick={() => void logout()}>{t('nav.logout')}</button></li>
            </ul>
          )}
        </div>
      </header>
      <StatusBanners />
      </div>
      <AnnouncementBanner />
      <main id="main" tabIndex={-1} className="stage">{children}</main>
      {!desktop && <TabBar me={me} mail={unreadMail} notes={unread} />}
      <CommandPalette me={me} open={palette} onClose={() => setPalette(false)} />
      <ShortcutsSheet open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  );
}

// The time, in the person's own format. Can be switched off in Settings → Appearance.
function Clock() {
  const t = useT();
  const [now, setNow] = useState(() => new Date());
  const [on, setOn] = useState(clockPref);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    const pref = () => setOn(clockPref());
    window.addEventListener('ui:clock', pref);
    return () => { clearInterval(id); window.removeEventListener('ui:clock', pref); };
  }, []);
  if (!on) return null;
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now);
  return <time className="clock" dateTime={now.toISOString()} aria-label={t('taskbar.time', { time })}>{time}</time>;
}

// Phones: the places people go most, one tap away, with the same unread numbers as the taskbar.
function TabBar({ me, mail, notes }: { me: Me; mail: number; notes: number }) {
  const t = useT();
  const location = useLocation();
  const here = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`));
  const items: { path: string; label: string; icon: ReactNode; count?: number }[] = [
    { path: '/', label: t('tabbar.home'), icon: <Icon name="home" /> },
    { path: '/boards', label: t('app.boards'), icon: <AppIcon id="boards" size={24} /> },
    ...(me.role !== 'guest' ? [{ path: '/mail', label: t('app.mail'), icon: <AppIcon id="mail" size={24} />, count: mail }] : []),
    { path: '/notifications', label: t('app.notifications'), icon: <AppIcon id="notifications" size={24} />, count: notes },
    { path: '/settings', label: t('tabbar.me'), icon: <Icon name="user" /> },
  ];
  return (
    <nav className="tabbar" aria-label={t('tabbar.label')}>
      {items.map((i) => (
        <Link key={i.path} to={i.path} aria-current={here(i.path) ? 'page' : undefined}>
          {i.icon}<span>{i.label}</span>
          {i.count ? <span className="badge badge-accent" aria-label={t('common.unreadCount', { count: i.count })}>{i.count > 99 ? t('common.lots') : i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

// A button for an open window. Click shows it (or minimizes it, if it is already in front); right-click or
// Shift+F10 offers the rest.
function TaskbarWindow({ win, front }: { win: Win; front: boolean }) {
  const t = useT();
  const { focus, minimize, toggleMaximize, snap, close } = useWindows();
  const title = t(appById(win.id).title);
  const ctx = useContextMenu(() => [
    { label: win.minimized || !front ? t('window.focus', { app: title }) : t('window.minimize', { app: title }), onSelect: () => (win.minimized || !front ? focus(win.id) : minimize(win.id)) },
    { label: win.maximized ? t('window.restore', { app: title }) : t('window.maximize', { app: title }), onSelect: () => toggleMaximize(win.id) },
    { label: t('window.snapLeft'), onSelect: () => snap(win.id, 'left') },
    { label: t('window.snapRight'), onSelect: () => snap(win.id, 'right') },
    { label: t('window.close', { app: title }), onSelect: () => close(win.id), danger: true },
  ]);
  return (
    <>
      <button
        type="button" className={`btn btn-quiet${front ? ' is-active' : ''}`}
        aria-label={t('window.focus', { app: title })} aria-pressed={front}
        onClick={() => (front ? minimize(win.id) : focus(win.id))} {...ctx.bind}
      ><AppIcon id={win.id} size={18} />{title}</button>
      {ctx.menu}
    </>
  );
}
