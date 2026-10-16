import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { BoardSummary, BookmarkView, MemoView, Me, WidgetChoice, WidgetId } from '@app/shared';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Alert, Avatar } from '../components/ui';
import { useIsDesktop, useSite, useT } from '../hooks';
import { appById } from './apps';
import { Oneliners } from './Oneliners';
import { WriteBox } from '../apps/memos/WriteBox';
import { RichText } from '../components/RichText';
import { TowerBoard } from './TowerBoard';
import { useWindows, type AppId } from './windows';
import { useDesktopLayout } from './desktopLayout';
import { addWidget, hiddenWidgets, hideWidget, moveWidget, resolveWidgets, sizeWidget } from './desktopLayout.logic';

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
  const marks = useQuery({ queryKey: ['bookmarks', 'hub'], queryFn: () => api.get<{ pinned: BookmarkView[]; recent: BookmarkView[]; total: number }>('/bookmarks/hub'), enabled: confirmed, staleTime: 30_000 }).data;
  const memos = useQuery({ queryKey: ['memos', 'hub'], queryFn: () => api.get<{ recent: MemoView[]; total: number }>('/memos/hub'), enabled: confirmed, staleTime: 30_000 }).data;
  const hideStart = dismissed();

  const go = (app: AppId, path = '') => {
    if (desktop) openWin(app, path); else navigate(`${appById(app).path}${path ? `/${path}` : ''}`);
  };
  const withNew = (boards ?? []).filter((b) => (b.unread ?? 0) > 0).sort((a, b) => (b.unread ?? 0) - (a.unread ?? 0));
  const unreadPosts = withNew.reduce((n, b) => n + (b.unread ?? 0), 0);
  const steps = gettingStarted({ me, homepageUpdated: Boolean(home?.homepage.last_updated_at), watchesABoard: (boards ?? []).some((b) => b.watching) });
  const others = (online ?? []).filter((p) => p.id !== me.id);
  const stepAction: Record<(typeof steps)[number]['key'], () => void> = {
    verify: () => go('settings', 'profile'), bio: () => go('settings', 'profile'), homepage: () => go('studio'),
    watch: () => go('boards'), twofa: () => go('settings', 'two-factor'),
  };

  const settings = useDesktopLayout((st) => st.settings);
  const loaded = useDesktopLayout((st) => st.loaded);
  const editing = useDesktopLayout((st) => st.editingHome) && loaded;
  const legacyHidden = hideStart;
  const list = resolveWidgets(settings, legacyHidden);
  const change = (fn: (l: WidgetChoice[]) => WidgetChoice[]) => useDesktopLayout.getState().changeWidgets(fn, legacyHidden);

  // Each widget's content, or null when it has nothing to show (it is then left out, except while arranging).
  const blocks: Record<WidgetId, ReactNode> = {
    stats: (
      <ul className="home-stats">
        <li><button type="button" className={unreadPosts ? 'is-new' : ''} onClick={() => go('boards')}><span className="num">{unreadPosts}</span><span className="label">{t('home.stat.posts', { count: unreadPosts })}</span></button></li>
        {confirmed && <li><button type="button" className={mail ? 'is-new' : ''} onClick={() => go('mail')}><span className="num">{mail}</span><span className="label">{t('home.stat.mail', { count: mail })}</span></button></li>}
        <li><button type="button" className={notes ? 'is-new' : ''} onClick={() => go('notifications')}><span className="num">{notes}</span><span className="label">{t('home.stat.notifications', { count: notes })}</span></button></li>
        {online && <li><button type="button" onClick={() => go('people')}><span className="num">{online.length}</span><span className="label">{t('home.stat.online', { count: online.length })}</span></button></li>}
      </ul>
    ),
    start: !steps.some((s) => !s.done) ? null : (
      <section className="panel home-start" aria-labelledby="home-start">
        <div className="panel-head">
          <h3 id="home-start">{t('home.start.title')}</h3>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => { try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* a convenience */ } change((l) => hideWidget(l, 'start')); }}>{t('home.start.hide')}</button>
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
    ),
    wall: confirmed ? <Oneliners /> : null,
    tower: confirmed && site.services.mud ? <TowerBoard limit={5} headingId="home-tower" /> : null,
    memos: !confirmed ? null : (
      <section className="panel" aria-labelledby="home-memos">
        <div className="panel-head">
          <h3 id="home-memos">{t('home.memos.title')}</h3>
          {memos && memos.total > 0 && <button type="button" className="btn btn-quiet btn-small" onClick={() => go('memos')}>{t('home.memos.all')}</button>}
        </div>
        <WriteBox compact />
        {memos && memos.recent.length > 0 && <ul className="rows home-memos">{memos.recent.slice(0, 3).map((m) => <li key={m.id}><RichText body={m.body} /></li>)}</ul>}
      </section>
    ),
    bookmarks: marks ? <HomeBookmarks marks={marks} open={(path) => go('bookmarks', path)} /> : null,
    new: withNew.length === 0 ? null : (
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
    ),
    online: others.length === 0 ? null : (
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
    ),
    links: !home ? null : (
      <p className="hint">
        <a href={home.homepage.url} target="_blank" rel="noopener noreferrer">{t('home.yourHomepage')}</a>
        {' · '}<button type="button" className="link" onClick={() => go('studio')}>{t('home.editHomepage')}</button>
        {site.services.bbs && <>{' · '}<button type="button" className="link" onClick={() => go('terminal')}>{t('home.callBbs')}</button></>}
      </p>
    ),
  };
  const missing = hiddenWidgets(list).filter((id) => id !== 'tower' || (confirmed && site.services.mud));

  return (
    <section className="home" aria-labelledby="home-title">
      <div className="home-greeting">
        <h2 id="home-title">{t('home.greeting', { name: me.display_name || me.handle })}</h2>
        <p>{unreadPosts + mail + notes > 0 ? t('home.summary') : t('home.quiet')}</p>
      </div>
      {application?.state === 'pending' && <Alert kind="info">{me.email_verified ? t('home.application.waiting') : t('home.application.confirmFirst')}</Alert>}

      {list.map((w, i) => {
        const node = blocks[w.id];
        if (!node && !editing) return null;
        const name = t(`home.widget.${w.id}`);
        return (
          <div key={w.id} className={`widget${w.size === 'wide' ? ' is-wide' : ''}${editing ? ' is-editing' : ''}`} data-widget={w.id}>
            {editing && (
              <div className="widget-bar" role="group" aria-label={name}>
                <strong>{name}</strong>
                <button type="button" className="btn btn-quiet btn-small" disabled={i === 0} aria-label={t('home.widget.up', { name })} onClick={() => change((l) => moveWidget(l, w.id, -1))}>↑</button>
                <button type="button" className="btn btn-quiet btn-small" disabled={i === list.length - 1} aria-label={t('home.widget.down', { name })} onClick={() => change((l) => moveWidget(l, w.id, 1))}>↓</button>
                {desktop && <button type="button" className="btn btn-quiet btn-small" aria-pressed={w.size === 'wide'} aria-label={t('home.widget.wide', { name })} onClick={() => change((l) => sizeWidget(l, w.id, w.size === 'wide' ? 'normal' : 'wide'))}>{t('home.widget.wideShort')}</button>}
                <button type="button" className="btn btn-quiet btn-small" aria-label={t('home.widget.hide', { name })} onClick={() => change((l) => hideWidget(l, w.id))}>{t('home.widget.hideShort')}</button>
              </div>
            )}
            {node ?? <p className="hint">{t('home.widget.empty')}</p>}
          </div>
        );
      })}

      {editing ? (
        <div className="widget-add">
          {missing.length > 0 && <h3>{t('home.widget.addTitle')}</h3>}
          {missing.length > 0 && <ul className="actions">{missing.map((id) => <li key={id}><button type="button" className="btn btn-small" onClick={() => change((l) => addWidget(l, id))}>{t('home.widget.add', { name: t(`home.widget.${id}`) })}</button></li>)}</ul>}
          <div className="actions"><button type="button" className="btn btn-primary" onClick={() => useDesktopLayout.getState().setEditingHome(false)}>{t('home.widget.done')}</button></div>
        </div>
      ) : (
        loaded && <p className="home-edit"><button type="button" className="link" onClick={() => useDesktopLayout.getState().setEditingHome(true)}>{t('home.widget.change')}</button></p>
      )}
    </section>
  );
}

// The personal hub (docs/21): pinned links first, then the newest. Set the site as the browser's home page to start here.
function HomeBookmarks({ marks, open }: { marks: { pinned: BookmarkView[]; recent: BookmarkView[]; total: number }; open: (path?: string) => void }) {
  const t = useT();
  const link = (b: BookmarkView) => (
    <a href={b.url} target="_blank" rel="noopener noreferrer" className="home-bookmark">
      {b.has_icon ? <img src={`/api/v1/bookmarks/${b.id}/icon?v=${encodeURIComponent(b.updated_at)}`} alt="" width={16} height={16} loading="lazy" /> : <Icon name="link" size={16} />}
      <span>{b.title}</span>
    </a>
  );
  return (
    <section className="panel" aria-labelledby="home-bookmarks">
      <div className="panel-head">
        <h3 id="home-bookmarks">{t('home.bookmarks.title')}</h3>
        {marks.total > 0
          ? <button type="button" className="btn btn-quiet btn-small" onClick={() => open()}>{t('home.bookmarks.all')}</button>
          : <button type="button" className="btn btn-quiet btn-small" onClick={() => open('add')}>{t('home.bookmarks.first')}</button>}
      </div>
      {marks.pinned.length > 0 && <ul className="home-pins">{marks.pinned.map((b) => <li key={b.id}>{link(b)}</li>)}</ul>}
      {marks.recent.length > 0 && <ul className="rows home-recent-marks">{marks.recent.map((b) => <li key={b.id}>{link(b)} <span className="row-meta">{b.host}</span></li>)}</ul>}
    </section>
  );
}

function where(t: ReturnType<typeof useT>, p: OnlinePerson): string {
  const places = [p.web && t('home.online.web'), p.chat && t('home.online.chat'), p.bbs && t('home.online.bbs')].filter(Boolean);
  return places.join(', ');
}
