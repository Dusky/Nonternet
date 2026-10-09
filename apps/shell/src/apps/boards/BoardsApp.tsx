import { useEffect, useRef, useState } from 'react';
import { FeedLink } from '../../components/FeedLink';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { THREAD_FILTERS, THREAD_SORTS, type BoardSummary, type ThreadFilter, type ThreadSort, type ThreadSummary } from '@app/shared';
import { RichText } from '../../components/RichText';
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
import { postNote, threadQuery, ThreadView } from './ThreadView';
import { eq, useLiveQuery } from '@tanstack/react-db';
import { boardsCollection } from '../../collections';
import { toast } from '../../components/feedback';

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
      {b.rules && <details className="board-rules"><summary>{t('boards.rules')}</summary><RichText body={b.rules} /></details>}
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
  // The order and filter are remembered on this device.
  const [sort, setSortState] = useState<ThreadSort>(() => stored<ThreadSort>('boards.sort', THREAD_SORTS, 'activity'));
  const [filter, setFilterState] = useState<ThreadFilter>(() => stored<ThreadFilter>('boards.filter', THREAD_FILTERS, 'all'));
  const setSort = (v: ThreadSort) => { setSortState(v); keep('boards.sort', v); };
  const setFilter = (v: ThreadFilter) => { setFilterState(v); keep('boards.filter', v); };
  const threads = useInfiniteQuery({
    queryKey: ['threads', slug, me?.id ?? null, sort, filter],
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams();
      if (pageParam !== undefined) qs.set('before', String(pageParam));
      if (sort !== 'activity') qs.set('sort', sort);
      if (filter !== 'all') qs.set('filter', filter);
      return api.get<{ threads: ThreadSummary[]; next: number | null }>(`/boards/${slug}/threads${qs.size ? `?${qs}` : ''}`);
    },
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
  // Muting changes the button at once; a refusal puts it back.
  const personalKey = ['me', 'personal'];
  const mute = useMutation({
    mutationFn: (on: boolean) => (on ? api.put(`/boards/${slug}/mute`, {}) : api.del(`/boards/${slug}/mute`)),
    onMutate: async (on) => {
      await qc.cancelQueries({ queryKey: personalKey });
      const before = qc.getQueryData(personalKey);
      qc.setQueryData<{ muted_boards: { slug: string; name: string }[] }>(personalKey, (p) => p && { ...p, muted_boards: on ? [...p.muted_boards, { slug, name: board.data?.name ?? slug }] : p.muted_boards.filter((m) => m.slug !== slug) });
      return { before };
    },
    onError: (e, _on, c) => { qc.setQueryData(personalKey, c?.before); toast(errorText(e), 'error'); },
    onSettled: () => void qc.invalidateQueries({ queryKey: personalKey }),
  });
  // Watching and "mark all read" go through the board list's collection (TanStack DB): the change shows at once.
  const coll = me ? boardsCollection(me.id) : null;
  const live = useLiveQuery((qb) => (coll ? qb.from({ b: coll }).where(({ b }) => eq(b.slug, slug)) : undefined), [coll, slug]);
  const liveBoard = (live.data as BoardSummary[] | undefined)?.[0];
  const watching = liveBoard?.watching ?? board.data?.watching ?? false;
  const unread = liveBoard ? liveBoard.unread : board.data?.unread ?? null;
  const report = (tx: { isPersisted: { promise: Promise<unknown> } }) => tx.isPersisted.promise.catch((e: unknown) => toast(errorText(e), 'error'));
  const toggleWatch = () => { if (coll && liveBoard) report(coll.update(slug, (d) => { d.watching = !watching; })); };
  const markRead = () => {
    if (!coll || !liveBoard) return;
    qc.setQueriesData<{ pages: { threads: ThreadSummary[]; next: number | null }[]; pageParams: unknown[] }>({ queryKey: ['threads', slug, me?.id ?? null] }, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, threads: pg.threads.map((th) => ({ ...th, unread: false })) })) });
    report(coll.update(slug, (d) => { d.unread = 0; }));
  };
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
        {me && <button className="btn" onClick={toggleWatch} aria-pressed={watching} disabled={!liveBoard}>{watching ? t('boards.unwatch') : t('boards.watch')}</button>}
        {me && me.role !== 'guest' && personal.data && <button className="btn" onClick={() => mute.mutate(!muted)} aria-pressed={muted}>{muted ? t('boards.unmute') : t('boards.mute')}</button>}
        {me && <button className="btn" onClick={markRead} disabled={!liveBoard || !unread}>{t('boards.markRead')}</button>}
        {me && <button className="btn" onClick={nextUnread} disabled={!list.some((x) => x.unread)}>{t('boards.nextUnread')}</button>}
        {me && <span className="spacer" />}
        {b.visibility === 'public' && <FeedLink href={`/feeds/boards/${slug}.atom`} title={b.name} />}
        <AppLink className="btn btn-quiet" to={`${slug}/modlog`}>{t('boards.modlog')}</AppLink>
        {b.can_moderate && <AppLink className="btn btn-quiet" to={`${slug}/settings`}>{t('boards.settings')}</AppLink>}
      </div>
      <div className="toolbar thread-filters">
        <label>{t('boards.sort.label')} <select value={sort} onChange={(e) => setSort(e.target.value as ThreadSort)}>{THREAD_SORTS.map((s) => <option key={s} value={s}>{t(`boards.sort.${s}`)}</option>)}</select></label>
        {me && <label>{t('boards.filter.label')} <select value={filter} onChange={(e) => setFilter(e.target.value as ThreadFilter)}>{THREAD_FILTERS.map((f) => <option key={f} value={f}>{t(`boards.filter.${f}`)}</option>)}</select></label>}
      </div>
      {!b.can_post && <p className="muted">{postNote(t, b, Boolean(me))}</p>}
      {threads.isError && <Alert kind="error" retry={() => void threads.refetch()}>{errorText(threads.error)}</Alert>}
      {threads.isSuccess && list.length === 0 && <EmptyState>{t('boards.noThreads')}</EmptyState>}
      <ul className="rows thread-rows" aria-label={t('boards.threadList')}>
        {list.map((th) => (
          <li key={th.id} className={th.unread ? 'is-unread' : undefined}>
            <div className="row-head">
              <span>
                <AppLink to={`${slug}/t/${th.id}`} data-nav className="thread-link" prefetch={() => void qc.prefetchInfiniteQuery(threadQuery(slug, th.id, me?.id ?? null))}><strong>{th.subject || '…'}</strong></AppLink>
                {th.pinned && <>{' '}<span className="badge sticker">{t('pin.badge')}</span></>}
                {th.locked && <>{' '}<span className="badge">{t('boards.badge.locked')}</span></>}
                {th.following && <>{' '}<span className="badge">{t('boards.badge.following')}</span></>}
              </span>
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

// A choice kept on this device, only if it is one of the known values.
function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try { const v = localStorage.getItem(key); return allowed.includes(v as T) ? (v as T) : fallback; } catch { return fallback; }
}
function keep(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* a convenience */ }
}
