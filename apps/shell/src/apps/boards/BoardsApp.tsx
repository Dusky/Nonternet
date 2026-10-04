import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BoardSummary, ThreadSummary } from '@app/shared';
import { api } from '../../api';
import { PersonLink } from '../people/PersonLink';
import { Alert, Avatar, BackLink, EmptyState, Loading, NotFound, RelativeTime } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { errorText, useMe, useT } from '../../hooks';
import { AppLink, matchRoute, useAppNav, useSubtitle } from '../../nav';
import { BoardSettings, NewBoard } from './BoardForms';
import { Composer } from './Composer';
import { useListKeys } from './keys';
import { Search } from './Search';
import { BulletinList, BulletinPage, PollList, PollPage } from './Classics';
import { usePersonal } from '../settings/PersonalSettings';
import { ModLog } from './ModLog';
import { ReportQueue } from './ReportQueue';
import { postNote, ThreadView } from './ThreadView';

const ROUTES = ['', 'new', 'search', 'search/:q', 'reports', 'bulletins', 'bulletins/:n', 'polls', 'polls/:pid', ':slug', ':slug/new', ':slug/settings', ':slug/modlog', ':slug/t/:id'] as const;

// Bulletins and the voting booth are for people with an account. A visitor who follows a link is asked to log in,
// and comes back here afterwards.
function MembersOnly() {
  const t = useT();
  const back = encodeURIComponent(location.pathname + location.search);
  return (
    <>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <Alert kind="info">{t('classics.membersOnly')} <a href={`/login?return_to=${back}`}>{t('auth.login')}</a></Alert>
    </>
  );
}

export default function BoardsApp() {
  const me = useMe().data;
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  if (!route) return <div className="app-content"><NotFound /></div>;
  const slug = route.params.slug;
  return (
    <div className="app-content">
      {route.pattern === '' && <BoardList />}
      {route.pattern === 'new' && <NewBoard />}
      {route.pattern === 'search' && <Search />}
      {route.pattern === 'search/:q' && <Search key={route.params.q} initial={route.params.q ?? ''} />}
      {route.pattern === 'reports' && <ReportsPage />}
      {/^(bulletins|polls)/.test(route.pattern) && !me && <MembersOnly />}
      {me && route.pattern === 'bulletins' && <BulletinList />}
      {me && route.pattern === 'bulletins/:n' && <BulletinPage number={Number(route.params.n)} />}
      {me && route.pattern === 'polls' && <PollList />}
      {me && route.pattern === 'polls/:pid' && <PollPage id={route.params.pid!} />}
      {route.pattern === ':slug' && <BoardPage slug={slug!} />}
      {route.pattern === ':slug/new' && <NewThread slug={slug!} />}
      {route.pattern === ':slug/settings' && <SettingsPage slug={slug!} />}
      {route.pattern === ':slug/modlog' && <ModLogPage slug={slug!} />}
      {route.pattern === ':slug/t/:id' && <ThreadView slug={slug!} id={route.params.id!} />}
    </div>
  );
}

function useBoard(slug: string) {
  const me = useMe().data;
  return useQuery({ queryKey: ['board', slug, me?.id ?? null], queryFn: () => api.get<BoardSummary>(`/boards/${slug}`) });
}

function Badges({ board }: { board: BoardSummary }) {
  const t = useT();
  return (
    <>
      {board.visibility === 'private' && <span className="badge">{t('boards.badge.private')}</span>}
      {board.visibility === 'members' && <span className="badge">{t('boards.badge.members')}</span>}
      {board.archived && <span className="badge">{t('boards.badge.archived')}</span>}
    </>
  );
}

// ---------------------------------------------------------------- the list of boards

function BoardList() {
  const t = useT();
  const me = useMe().data;
  const root = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['boards', me?.id ?? null],
    queryFn: () => api.get<{ categories: { id: string; name: string }[]; boards: BoardSummary[] }>('/boards'),
  });
  useListKeys(root);
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading rows={4} />;
  const { categories, boards } = q.data;
  const ringNames = [...new Set(boards.filter((b) => b.ring).map((b) => b.ring!.name))].sort();
  const groups = [
    ...categories.map((c) => ({ key: c.id, title: c.name, boards: boards.filter((b) => !b.ring && b.category?.id === c.id) })),
    { key: 'other', title: categories.length ? t('boards.list.other') : ringNames.length ? t('boards.list.boards') : '', boards: boards.filter((b) => !b.ring && !b.category) },
    // Each ring has one board, named after the ring, so they share one heading rather than repeating each name.
    { key: 'rings', title: t('boards.list.rings'), boards: ringNames.flatMap((n) => boards.filter((b) => b.ring?.name === n)) },
  ].filter((g) => g.boards.length > 0);
  return (
    <div ref={root}>
      <div className="toolbar">
        {(me?.role === 'trusted' || me?.role === 'admin') && <AppLink className="btn btn-primary" to="new">{t('boards.new')}</AppLink>}
        <AppLink className="btn" to="search"><Icon name="search" />{t('boards.search')}</AppLink>
        {me && me.role !== 'guest' && <AppLink className="btn" to="bulletins">{t('classics.bulletins')}</AppLink>}
        {me && me.role !== 'guest' && <AppLink className="btn" to="polls">{t('classics.polls')}</AppLink>}
        {(me?.role === 'admin' || me?.ops.some((o) => o.startsWith('board:')) || boards.some((b) => b.can_moderate)) && <AppLink className="btn" to="reports">{t('boards.reports')}</AppLink>}
      </div>
      {boards.length === 0 && <EmptyState>{t('boards.list.none')}</EmptyState>}
      {groups.map((g) => (
        <section key={g.key} aria-label={g.title || undefined}>
          {g.title && <h2>{g.title}</h2>}
          <ul className="rows board-rows">
            {g.boards.map((b) => (
              <li key={b.id}>
                <div className="row-head">
                  <span><AppLink to={b.slug} data-nav className="board-link"><strong>{b.name}</strong></AppLink> <Badges board={b} /></span>
                  {b.unread ? <span className="badge badge-accent">{t('boards.unread', { count: b.unread })}</span> : null}
                </div>
                {b.description && <p>{b.description}</p>}
                <p className="row-meta">{t('boards.threads', { count: b.thread_count })}{b.last_post_at ? <> · <RelativeTime iso={b.last_post_at} /></> : null}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- one board

function BoardPage({ slug }: { slug: string }) {
  const t = useT();
  const me = useMe().data;
  const nav = useAppNav();
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const board = useBoard(slug);
  const threads = useInfiniteQuery({
    queryKey: ['threads', slug, me?.id ?? null],
    queryFn: ({ pageParam }) => api.get<{ threads: ThreadSummary[]; next: number | null }>(`/boards/${slug}/threads${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const list = threads.data?.pages.flatMap((p) => p.threads) ?? [];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['boards'] });
    void qc.invalidateQueries({ queryKey: ['board', slug] });
    void qc.invalidateQueries({ queryKey: ['threads', slug] });
  };
  const personal = usePersonal(Boolean(me));
  const muted = Boolean(personal.data?.muted_boards.some((m) => m.slug === slug));
  const mute = useMutation({
    mutationFn: (on: boolean) => (on ? api.put(`/boards/${slug}/mute`, {}) : api.del(`/boards/${slug}/mute`)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'personal'] }),
  });
  const watch = useMutation({
    mutationFn: (on: boolean) => (on ? api.put(`/boards/${slug}/watch`, {}) : api.del(`/boards/${slug}/watch`)),
    onSuccess: refresh,
  });
  const markRead = useMutation({ mutationFn: () => api.put(`/boards/${slug}/read-pointer`, { all: true }), onSuccess: refresh });
  const nextUnread = () => { const n = list.find((x) => x.unread); if (n) nav.go(`${slug}/t/${n.id}`); };
  useListKeys(root, { n: nextUnread });

  // A new thread or anything read elsewhere should show up when the window comes back into view.
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useSubtitle(board.data?.name);
  if (board.isError) return <Alert kind="error" retry={() => void board.refetch()}>{errorText(board.error)}</Alert>;
  const b = board.data;
  if (!b) return <Loading rows={4} />;
  return (
    <div ref={root}>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <h2>{b.name} <Badges board={b} /></h2>
      {b.description && <p>{b.description}</p>}
      <p className="hint">{t('boards.ownedBy')} <PersonLink app="people" to={b.owner.handle}>@{b.owner.handle}</PersonLink></p>
      <div className="toolbar">
        {b.can_post && <AppLink className="btn btn-primary" to={`${slug}/new`}>{t('boards.newThread')}</AppLink>}
        {me && <button className="btn" onClick={() => watch.mutate(!b.watching)} aria-pressed={b.watching} disabled={watch.isPending}>{b.watching ? t('boards.unwatch') : t('boards.watch')}</button>}
        {me && me.role !== 'guest' && personal.data && <button className="btn" onClick={() => mute.mutate(!muted)} aria-pressed={muted} disabled={mute.isPending}>{muted ? t('boards.unmute') : t('boards.mute')}</button>}
        {me && <button className="btn" onClick={() => markRead.mutate()} disabled={markRead.isPending || !b.unread}>{t('boards.markRead')}</button>}
        {me && <button className="btn" onClick={nextUnread} disabled={!list.some((x) => x.unread)}>{t('boards.nextUnread')}</button>}
        {me && <span className="spacer" />}
        <AppLink className="btn btn-quiet" to={`${slug}/modlog`}>{t('boards.modlog')}</AppLink>
        {b.can_moderate && <AppLink className="btn btn-quiet" to={`${slug}/settings`}>{t('boards.settings')}</AppLink>}
      </div>
      {!b.can_post && <p className="muted">{postNote(t, b, Boolean(me))}</p>}
      {threads.isError && <Alert kind="error" retry={() => void threads.refetch()}>{errorText(threads.error)}</Alert>}
      {threads.isSuccess && list.length === 0 && <EmptyState>{t('boards.noThreads')}</EmptyState>}
      <ul className="rows thread-rows" aria-label={t('boards.threadList')}>
        {list.map((th) => (
          <li key={th.id} className={th.unread ? 'is-unread' : undefined}>
            <div className="row-head">
              <AppLink to={`${slug}/t/${th.id}`} data-nav className="thread-link"><strong>{th.subject || '…'}</strong></AppLink>
              {th.unread && <span className="badge badge-accent">{t('boards.newBadge')}</span>}
            </div>
            <p className="row-meta">
              {th.author && <span className="person"><Avatar id={th.author.id} name={th.author.display_name || th.author.handle} size="sm" />{th.author.display_name || th.author.handle}</span>}
              {th.author ? ' · ' : ''}{t('boards.replies', { count: th.reply_count })} · <RelativeTime iso={th.last_post_at} />
            </p>
          </li>
        ))}
      </ul>
      {threads.hasNextPage && <button className="btn" onClick={() => void threads.fetchNextPage()} disabled={threads.isFetchingNextPage}>{t('boards.more')}</button>}
      <p className="hint">{t(me ? 'boards.keys' : 'boards.keysVisitor')}</p>
    </div>
  );
}

function NewThread({ slug }: { slug: string }) {
  const t = useT();
  const nav = useAppNav();
  const board = useBoard(slug);
  if (board.isError) return <Alert kind="error" retry={() => void board.refetch()}>{errorText(board.error)}</Alert>;
  if (!board.data) return <Loading />;
  return (
    <>
      <BackLink to={slug}>{t('boards.back', { name: board.data.name })}</BackLink>
      <h2>{t('boards.newThread')}</h2>
      {board.data.can_post
        ? <Composer slug={slug} onPosted={(p) => nav.go(`${slug}/t/${p.thread_id}`)} onCancel={() => nav.go(slug)} />
        : <p className="muted">{postNote(t, board.data, Boolean(useMe().data))}</p>}
    </>
  );
}

function ReportsPage() {
  const t = useT();
  return (
    <>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <h2>{t('boards.reports')}</h2>
      <ReportQueue />
    </>
  );
}

function ModLogPage({ slug }: { slug: string }) {
  const board = useBoard(slug);
  return <ModLog slug={slug} canUndo={Boolean(board.data?.can_moderate)} />;
}

function SettingsPage({ slug }: { slug: string }) {
  const board = useBoard(slug);
  if (board.isError) return <Alert kind="error" retry={() => void board.refetch()}>{errorText(board.error)}</Alert>;
  if (!board.data) return <Loading />;
  return <BoardSettings board={board.data} key={board.data.id + String(board.dataUpdatedAt)} />;
}
