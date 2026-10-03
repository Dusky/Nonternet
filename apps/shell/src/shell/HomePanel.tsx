import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary, Me } from '@app/shared';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Alert, Avatar } from '../components/ui';
import { useIsDesktop, useSite, useT } from '../hooks';
import { appById } from './apps';
import { Oneliners } from './Oneliners';
import { TowerBoard } from './TowerBoard';
import { useWindows, type AppId } from './windows';

export interface OnlinePerson { id: string; handle: string; display_name: string | null; status_line: string | null; away: boolean; web: boolean; chat: boolean; bbs: { node: number; where: string; via: string } | null }
interface HomeSummary { homepage: { url: string; last_updated_at: string | null } }

// What a person can do next, worked out from what they have already done. Pure, so it is tested
// on its own; the panel hides the list once everything is ticked or the person dismisses it.
export function gettingStarted(input: { me: Me; homepageUpdated: boolean; watchesABoard: boolean }) {
  const { me } = input;
  return [
    ...(me.role === 'guest' && !me.email_verified ? [{ key: 'verify', done: false }] : []),
    { key: 'bio', done: Boolean(me.bio?.trim()) },
    { key: 'homepage', done: input.homepageUpdated },
    { key: 'watch', done: input.watchesABoard },
    { key: 'twofa', done: me.totp_enabled },
  ] as { key: 'verify' | 'bio' | 'homepage' | 'watch' | 'twofa'; done: boolean }[];
}

const DISMISS_KEY = 'ui:home:started-dismissed';
const dismissed = () => { try { return window.localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

// The "what's new" side of the home screen: unread counts, boards with new posts, who's online, and
// a few first steps for someone new. It only shows what has something in it.
export function HomePanel({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const openWin = useWindows((s) => s.open);
  const confirmed = me.role !== 'guest';
  const boards = useQuery({ queryKey: ['boards', me.id], queryFn: () => api.get<{ boards: BoardSummary[] }>('/boards'), staleTime: 30_000, refetchInterval: 120_000 }).data?.boards;
  const mail = useQuery({ queryKey: ['mail', 'unread', me.id], queryFn: () => api.get<{ unread: number }>('/mail/unread'), enabled: confirmed, staleTime: 15_000 }).data?.unread ?? 0;
  const notes = useQuery({ queryKey: ['notifications', 'count', me.id], queryFn: () => api.get<{ unread: number }>('/notifications/count'), staleTime: 15_000 }).data?.unread ?? 0;
  const online = useQuery({ queryKey: ['online'], queryFn: () => api.get<{ people: OnlinePerson[] }>('/online'), enabled: confirmed, refetchInterval: 60_000 }).data?.people;
  const home = useQuery({ queryKey: ['homes', 'me'], queryFn: () => api.get<HomeSummary>('/homes/me'), staleTime: 60_000, retry: false }).data;
  // Signed up by application and not approved yet (docs/02): say so, rather than leave them wondering.
  const application = useQuery({ queryKey: ['me', 'application'], queryFn: () => api.get<{ application: { state: string } | null }>('/me/application'), enabled: !confirmed, staleTime: 60_000 }).data?.application;
  const [hideStart, setHideStart] = useState(dismissed);

  const go = (app: AppId, path = '') => {
    if (desktop) openWin(app, path); else navigate(`${appById(app).path}${path ? `/${path}` : ''}`);
  };
  const withNew = (boards ?? []).filter((b) => (b.unread ?? 0) > 0).sort((a, b) => (b.unread ?? 0) - (a.unread ?? 0));
  const unreadPosts = withNew.reduce((n, b) => n + (b.unread ?? 0), 0);
  const steps = gettingStarted({ me, homepageUpdated: Boolean(home?.homepage.last_updated_at), watchesABoard: (boards ?? []).some((b) => b.watching) });
  const showSteps = !hideStart && steps.some((s) => !s.done);
  const others = (online ?? []).filter((p) => p.id !== me.id);
  const stepAction: Record<(typeof steps)[number]['key'], () => void> = {
    verify: () => go('settings', 'profile'), bio: () => go('settings', 'profile'), homepage: () => go('studio'),
    watch: () => go('boards'), twofa: () => go('settings', 'two-factor'),
  };

  return (
    <section className="home" aria-labelledby="home-title">
      <div className="home-greeting">
        <h2 id="home-title">{t('home.greeting', { name: me.display_name || me.handle })}</h2>
        <p>{unreadPosts + mail + notes > 0 ? t('home.summary') : t('home.quiet')}</p>
      </div>
      {application?.state === 'pending' && <Alert kind="info">{me.email_verified ? t('home.application.waiting') : t('home.application.confirmFirst')}</Alert>}

      <ul className="home-stats">
        <li><button type="button" className={unreadPosts ? 'is-new' : ''} onClick={() => go('boards')}><span className="num">{unreadPosts}</span><span className="label">{t('home.stat.posts', { count: unreadPosts })}</span></button></li>
        {confirmed && <li><button type="button" className={mail ? 'is-new' : ''} onClick={() => go('mail')}><span className="num">{mail}</span><span className="label">{t('home.stat.mail', { count: mail })}</span></button></li>}
        <li><button type="button" className={notes ? 'is-new' : ''} onClick={() => go('notifications')}><span className="num">{notes}</span><span className="label">{t('home.stat.notifications', { count: notes })}</span></button></li>
        {online && <li><button type="button" onClick={() => go('people')}><span className="num">{online.length}</span><span className="label">{t('home.stat.online', { count: online.length })}</span></button></li>}
      </ul>

      {showSteps && (
        <section className="panel" aria-labelledby="home-start">
          <div className="panel-head">
            <h3 id="home-start">{t('home.start.title')}</h3>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => { setHideStart(true); try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* a convenience */ } }}>{t('home.start.hide')}</button>
          </div>
          <ul className="checklist">
            {steps.map((s) => (
              <li key={s.key} className={s.done ? 'is-done' : undefined}>
                <span className="tick" aria-hidden="true">{s.done && <Icon name="check" />}</span>
                {s.done
                  ? <span>{t(`home.start.${s.key}`)} <span className="sr-only">{t('home.start.done')}</span></span>
                  : <button type="button" className="link" onClick={stepAction[s.key]}>{t(`home.start.${s.key}`)}</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirmed && <Oneliners />}
      {confirmed && site.services.mud && <TowerBoard limit={5} headingId="home-tower" />}

      {withNew.length > 0 && (
        <section className="panel" aria-labelledby="home-new">
          <div className="panel-head">
            <h3 id="home-new">{t('home.new.title')}</h3>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => go('boards')}>{t('home.new.all')}</button>
          </div>
          <ul className="rows">
            {withNew.slice(0, 5).map((b) => (
              <li key={b.id} className="row-head">
                <button type="button" className="link" onClick={() => go('boards', b.slug)}>{b.name}</button>
                <span className="badge badge-accent">{t('boards.unread', { count: b.unread ?? 0 })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="panel" aria-labelledby="home-online">
          <h3 id="home-online">{t('home.online.title')}</h3>
          <ul className="people-strip">
            {others.slice(0, 24).map((p) => (
              <li key={p.id}>
                <button type="button" className="btn btn-quiet btn-small person" onClick={() => go('people', p.handle)} title={where(t, p)}>
                  <Avatar id={p.id} name={p.display_name || p.handle} size="sm" />{p.display_name || p.handle}
                  <span className="sr-only">, {where(t, p)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home && (
        <p className="hint">
          <a href={home.homepage.url} target="_blank" rel="noopener noreferrer">{t('home.yourHomepage')}</a>
          {' · '}<button type="button" className="link" onClick={() => go('studio')}>{t('home.editHomepage')}</button>
          {site.services.bbs && <>{' · '}<button type="button" className="link" onClick={() => go('terminal')}>{t('home.callBbs')}</button></>}
        </p>
      )}
    </section>
  );
}

function where(t: ReturnType<typeof useT>, p: OnlinePerson): string {
  const places = [p.web && t('home.online.web'), p.chat && t('home.online.chat'), p.bbs && t('home.online.bbs')].filter(Boolean);
  return places.join(', ');
}
