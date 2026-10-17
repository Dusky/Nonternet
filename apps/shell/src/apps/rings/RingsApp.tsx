import { PersonLink } from '../people/PersonLink';
import { useConfirm } from '../../components/feedback';
import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { JOIN_POLICIES, type WikiInfo, type RingDetail, type RingMemberView, type RingSummary } from '@app/shared';
import { SharedLinks } from '../bookmarks/SharedLinks';
import { SharedMemos } from '../memos/SharedMemos';
import { api } from '../../api';
import { Alert, BackLink, CopyButton, EmptyState, Loading, NotFound, TextField } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { AppLink, matchRoute, useAppNav, useSubtitle } from '../../nav';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { RingOrbit } from '../../components/Spots';
import { Banners, BannerStrip } from './RingBanners';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';

const ROUTES = ['', 'new', ':slug'] as const;

export default function RingsApp() {
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  if (!route) return <div className="app-content"><NotFound /></div>;
  return (
    <div className="app-content">
      {route.pattern === '' && <Directory />}
      {route.pattern === 'new' && <FoundRing />}
      {route.pattern === ':slug' && <RingPage slug={route.params.slug!} />}
    </div>
  );
}

const parseTags = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- directory

function Directory() {
  const t = useT();
  const me = useMe().data;
  const nav = useAppNav();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<'newest' | 'active' | 'name'>('newest');
  const [error, setError] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['rings', term, tag, sort, me?.id ?? null],
    placeholderData: keepPreviousData, // the last results stay while new ones load, so typing doesn't flash "Loading"
    queryFn: ({ pageParam }) => api.get<{ rings: RingSummary[]; next: number | null }>(`/rings?sort=${sort}&offset=${pageParam}${term ? `&q=${encodeURIComponent(term)}` : ''}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const random = useMutation({ mutationFn: () => api.get<{ slug: string }>('/rings/random'), onSuccess: (r) => nav.go(r.slug), onError: (e) => setError(errorText(e)) });
  const items = list.data?.pages.flatMap((p) => p.rings) ?? [];
  const allTags = [...new Set(items.flatMap((r) => r.tags))].sort();
  return (
    <>
      <RingOrbit />
      <form role="search" className="search-form" onSubmit={(e: FormEvent) => { e.preventDefault(); setTerm(q.trim()); }}>
        <TextField label={t('rings.search')} value={q} onChange={setQ} type="search" />
        <div className="field">
          <label htmlFor="ring-tag">{t('rings.tag')}</label>
          <select id="ring-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t('rings.tag.any')}</option>
            {allTags.map((x) => <option key={x} value={x}>{x}</option>)}
            {tag && !allTags.includes(tag) && <option value={tag}>{tag}</option>}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ring-sort">{t('rings.sort')}</label>
          <select id="ring-sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            {(['newest', 'active', 'name'] as const).map((s) => <option key={s} value={s}>{t(`rings.sort.${s}`)}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">{t('boards.search.go')}</button>
      </form>
      <div className="toolbar">
        {(me?.role === 'trusted' || me?.role === 'admin') && <AppLink className="btn btn-primary" to="new">{t('rings.found')}</AppLink>}
        <button className="btn" type="button" onClick={() => random.mutate()}>{t('rings.random')}</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {list.isError && <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>}
      {list.isSuccess && items.length === 0 && <EmptyState art="ring">{t('rings.none')}</EmptyState>}
      {list.isPending && <Loading rows={3} />}
      <ul className="cards">
        {items.map((r) => (
          <li key={r.id}>
            <div className="row-head">
              <AppLink to={r.slug} className="board-link"><strong>{r.name}</strong></AppLink>
              {r.archived && <span className="badge">{t('rings.archived')}</span>}
            </div>
            {r.description && <p className="snippet">{r.description}</p>}
            <p className="row-meta">{t('rings.members', { count: r.member_count })} · {t(`rings.policy.${r.join_policy}`)}</p>
            {r.tags.length > 0 && <p className="tags">{r.tags.map((x) => <button key={x} type="button" className="badge tag" onClick={() => setTag(x)} aria-label={t('rings.filterTag', { tag: x })}>{x}</button>)}</p>}
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('homepages.more')}</button>}
    </>
  );
}

// ---------------------------------------------------------------- founding

function FoundRing() {
  const t = useT();
  const nav = useAppNav();
  const qc = useQueryClient();
  const [f, setF] = useState({ slug: '', name: '', description: '', about: '', tags: '', join_policy: 'open' });
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<RingSummary>('/rings', { slug: f.slug, name: f.name, description: f.description, about: f.about, tags: parseTags(f.tags), join_policy: f.join_policy }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['rings'] }); void qc.invalidateQueries({ queryKey: ['me'] }); nav.go(r.slug); },
    onError: (e) => setError(errorText(e)),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <>
      <BackLink to="">{t('rings.back')}</BackLink>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }}>
        <h2>{t('rings.form.title')}</h2>
        <TextField label={t('rings.form.slug')} hint={t('rings.form.slugHint')} value={f.slug} onChange={(v) => set('slug')(v.toLowerCase())} maxLength={24} autoCapitalize="none" spellCheck={false} required />
        <TextField label={t('rings.form.name')} value={f.name} onChange={set('name')} maxLength={60} required />
        <TextField label={t('rings.form.description')} value={f.description} onChange={set('description')} maxLength={300} />
        <TextField label={t('rings.form.about')} value={f.about} onChange={set('about')} maxLength={5000} multiline />
        <TextField label={t('rings.form.tags')} hint={t('rings.form.tagsHint')} value={f.tags} onChange={set('tags')} autoCapitalize="none" />
        <div className="field">
          <label htmlFor="ring-policy">{t('rings.form.policy')}</label>
          <select id="ring-policy" value={f.join_policy} onChange={(e) => set('join_policy')(e.target.value)}>
            {JOIN_POLICIES.map((p) => <option key={p} value={p}>{t(`rings.policy.${p}`)}</option>)}
          </select>
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending}>{t('rings.form.create')}</button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- one ring

function RingPage({ slug }: { slug: string }) {
  const t = useT();
  const me = useMe().data;
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['ring', slug, me?.id ?? null], queryFn: () => api.get<RingDetail>(`/rings/${slug}`) });
  const refresh = () => { for (const k of ['ring', 'rings', 'boards', 'me']) void qc.invalidateQueries({ queryKey: [k] }); };
  const join = useMutation({ mutationFn: () => api.post<{ status: string }>(`/rings/${slug}/join`), onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  const confirmLeave = useConfirm();
  const leave = useMutation({ mutationFn: () => api.post(`/rings/${slug}/leave`), onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  useSubtitle(q.data?.name);
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const r = q.data;
  if (!r) return <Loading />;
  const status = r.me?.status ?? null;
  return (
    <>
      <BackLink to="">{t('rings.back')}</BackLink>
      <h2>{r.name} {r.archived && <span className="badge">{t('rings.archived')}</span>}</h2>
      {r.description && <p>{r.description}</p>}
      <p className="hint">
        {t('rings.foundedBy')} <PersonLink app="people" to={r.founder.handle}>@{r.founder.handle}</PersonLink> · {t('rings.members', { count: r.member_count })} · {t(`rings.policy.${r.join_policy}`)}
        {r.tags.length > 0 && ` · ${r.tags.join(', ')}`}
      </p>
      <BannerStrip slug={slug} />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="toolbar">
        {r.board && <OpenAppLink app="boards" to={r.board.slug} className="btn">{t('rings.board')}</OpenAppLink>}
        {r.wiki_enabled && <OpenAppLink app="wiki" to={`r/${slug}`} className="btn">{t('rings.wiki')}</OpenAppLink>}
        {me && status === null && !r.archived && r.join_policy !== 'invite' && (
          <button className="btn btn-primary" onClick={() => join.mutate()} disabled={join.isPending}>{r.join_policy === 'approval' ? t('rings.requestJoin') : t('rings.join')}</button>
        )}
        {r.me?.is_op && <button type="button" className="btn" onClick={() => { const h = document.getElementById('manage-h'); h?.scrollIntoView({ block: 'start' }); h?.focus({ preventScroll: true }); }}>{t('rings.manage')}</button>}
        {me && status === 'invited' && <button className="btn btn-primary" onClick={() => join.mutate()} disabled={join.isPending}>{t('rings.acceptInvite')}</button>}
        {me && (status === 'member' || status === 'invited' || status === 'pending') && !r.me?.is_founder && (
          <button className="btn" onClick={() => void confirmLeave({ message: t('rings.leaveConfirm'), confirmLabel: t('rings.leave'), danger: true }).then((ok) => ok && leave.mutate())} disabled={leave.isPending}>{t('rings.leave')}</button>
        )}
      </div>
      {status === 'pending' && <p className="muted">{t('rings.pending')}</p>}
      {status === 'banned' && <p className="muted">{t('rings.banned')}</p>}
      {status === null && r.join_policy === 'invite' && <p className="muted">{t('rings.inviteOnly')}</p>}
      {!me && <p className="muted"><AppLink to="">{t('boards.loginToPost')}</AppLink></p>}

      {r.about && <section aria-labelledby="about-h"><h3 id="about-h">{t('rings.about')}</h3><p className="post-body">{r.about}</p></section>}

      <section aria-labelledby="latest-h">
        <h3 id="latest-h">{t('rings.latest')}</h3>
        {r.latest_posts.length === 0 && <EmptyState>{t('rings.latest.none')}</EmptyState>}
        <ul className="rows">
          {r.latest_posts.map((p) => (
            <li key={p.id}>
              <OpenAppLink app="boards" to={`${r.board!.slug}/t/${p.thread_id}`}>{p.subject}</OpenAppLink>{' '}
              <span className="muted">{p.author ? t('boards.by', { name: p.author }) : ''}</span>
            </li>
          ))}
        </ul>
      </section>

      {status === 'member' && <SharedMemos source={{ ring: slug }} title={t('rings.sharedMemos')} headingId="ring-memos-h" />}
      <SharedLinks source={{ ring: slug }} title={t('rings.sharedLinks')} headingId="ring-links-h" />
      <Members ring={r} />
      <p className="hint">{t('rings.ops')}: {r.ops.map((o, i) => <span key={o.op_id}>{i > 0 && ', '}<PersonLink app="people" to={o.handle}>@{o.handle}</PersonLink></span>)}</p>
      {status === 'member' && <p className="badge ring-you">{r.me?.is_op ? t('rings.youRun') : t('rings.youBelong')}</p>}
      {status === 'member' && <NavBar slug={slug} />}
      {status === 'member' && !r.me?.is_op && <Banners slug={slug} name={r.name} manage={false} />}
      {r.me?.is_op && <Manage ring={r} onChange={refresh} />}
    </>
  );
}

function Members({ ring }: { ring: RingDetail }) {
  const t = useT();
  const list = useInfiniteQuery({
    queryKey: ['ring', ring.slug, 'members', ring.me?.is_op ?? false],
    queryFn: ({ pageParam }) => api.get<{ members: RingMemberView[]; next: number | null }>(`/rings/${ring.slug}/members?offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const members = list.data?.pages.flatMap((p) => p.members) ?? [];
  return (
    <section aria-labelledby="members-h">
      <h3 id="members-h">{t('rings.membersHeading')}</h3>
      <ul className="rows">
        {members.map((m) => (
          <li key={m.user_id}>
            <strong>{m.display_name || m.handle}</strong>{m.display_name && <span className="muted"> @{m.handle}</span>}{' '}
            {m.homepage_url ? <a href={m.homepage_url} target="_blank" rel="noopener noreferrer" aria-label={`${t('rings.members.page')} ${m.handle}`}>{t('rings.members.page')}</a> : <span className="muted">{t('rings.members.noPage')}</span>}
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button className="btn" onClick={() => void list.fetchNextPage()}>{t('homepages.more')}</button>}
    </section>
  );
}

function NavBar({ slug }: { slug: string }) {
  const t = useT();
  const [style, setStyle] = useState<'bar' | 'buttons' | 'banner'>('bar');
  const q = useQuery({ queryKey: ['ring', slug, 'snippet', style], queryFn: () => api.get<{ html: string }>(`/rings/${slug}/snippet?style=${style}`) });
  return (
    <section aria-labelledby="nav-h" className="panel">
      <h3 id="nav-h">{t('rings.navbar.title')}</h3>
      <p>{t('rings.navbar.hint')}</p>
      <div className="field">
        <label htmlFor="nav-style">{t('rings.navbar.style')}</label>
        <select id="nav-style" value={style} onChange={(e) => setStyle(e.target.value as typeof style)}>
          {(['bar', 'buttons', 'banner'] as const).map((s) => <option key={s} value={s}>{t(`rings.navbar.style.${s}`)}</option>)}
        </select>
      </div>
      {q.data && <><pre className="terminal" tabIndex={0} role="group" aria-label={t('rings.navbar.title')}>{q.data.html}</pre><CopyButton text={q.data.html} /></>}
    </section>
  );
}

// ---------------------------------------------------------------- managing (ops)

function ReasonInput({ onSubmit, onCancel, label, pending }: { onSubmit: (reason: string) => void; onCancel?: () => void; label: string; pending: boolean }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }} aria-label={label}>
      <TextField label={t('rings.manage.reason')} value={reason} onChange={setReason} minLength={3} maxLength={500} required />
      <div className="actions">
        <button className="btn btn-primary" type="submit" disabled={pending}>{label}</button>
        {onCancel && <button className="btn btn-quiet" type="button" onClick={onCancel}>{t('common.cancel')}</button>}
      </div>
    </form>
  );
}

type ManageTab = 'requests' | 'members' | 'ops' | 'details' | 'banners';
const MANAGE_TABS: ManageTab[] = ['requests', 'members', 'ops', 'details', 'banners'];
const PAGE = 100;

// Running the ring, in tabs (docs/06): requests and invitations, members (with a filter and paging), ops and hand-over,
// the ring's details and archive, and the banners. Each tab is one job; the dangerous ones sit apart and ask first.
function Manage({ ring, onChange }: { ring: RingDetail; onChange: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState<ManageTab>('requests');
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<null | { m: RingMemberView; action: 'remove' | 'ban'; withdraw?: boolean }>(null);
  const useStatus = (s: 'member' | 'pending' | 'invited' | 'banned') => useInfiniteQuery({
    queryKey: ['ring', ring.slug, 'manage', s],
    queryFn: ({ pageParam }) => api.get<{ members: RingMemberView[]; next: number | null }>(`/rings/${ring.slug}/members?status=${s}&limit=${PAGE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const lists = { member: useStatus('member'), pending: useStatus('pending'), invited: useStatus('invited'), banned: useStatus('banned') };
  const rows = (s: keyof typeof lists) => lists[s].data?.pages.flatMap((p) => p.members) ?? [];
  const done = () => { setActing(null); setError(null); onChange(); void qc.invalidateQueries({ queryKey: ['ring', ring.slug] }); };
  const fail = (e: unknown) => setError(errorText(e));
  const act = useMutation({ mutationFn: (v: { id: string; action: string; reason?: string }) => api.post(`/rings/${ring.slug}/members/${v.id}/${v.action}`, v.reason ? { reason: v.reason } : {}), onSuccess: done, onError: fail });
  const waiting = rows('pending').length;
  const label = (k: ManageTab) => (k === 'requests' && waiting ? `${t('rings.manage.tab.requests')} (${waiting})` : t(`rings.manage.tab.${k}`));
  const ctx = { ring, rows, lists, act, setActing, done, fail };
  return (
    <section aria-labelledby="manage-h" className="panel ring-manage" id="ring-manage">
      <h3 id="manage-h" tabIndex={-1}>{t('rings.manage')}</h3>
      {error && <Alert kind="error">{error}</Alert>}
      <Tabs selectedKey={tab} onSelectionChange={(k) => { setTab(k as ManageTab); setActing(null); setError(null); }}>
        <TabList className="tabs ring-manage-tabs" aria-label={t('rings.manage')}>
          {MANAGE_TABS.map((k) => <Tab key={k} id={k}>{label(k)}</Tab>)}
        </TabList>
        {/* One panel per tab, so each tab points at its own panel (only the open one is drawn). */}
        <TabPanel id="requests"><RequestsTab {...ctx} /></TabPanel>
        <TabPanel id="members"><MembersTab {...ctx} /></TabPanel>
        <TabPanel id="ops"><OpsTab ring={ring} done={done} fail={fail} /></TabPanel>
        <TabPanel id="details"><DetailsTab ring={ring} done={done} fail={fail} /></TabPanel>
        <TabPanel id="banners"><Banners slug={ring.slug} name={ring.name} manage headingId="manage-banners-h" /></TabPanel>
      </Tabs>
      {acting && (
        <ReasonInput
          label={acting.withdraw ? t('rings.manage.withdraw', { name: acting.m.handle }) : t(`rings.manage.${acting.action}`, { name: acting.m.handle })}
          pending={act.isPending} onCancel={() => setActing(null)}
          onSubmit={(reason) => act.mutate({ id: acting.m.user_id, action: acting.action, reason })} />
      )}
    </section>
  );
}

interface TabCtx {
  ring: RingDetail;
  rows: (s: 'member' | 'pending' | 'invited' | 'banned') => RingMemberView[];
  lists: Record<'member' | 'pending' | 'invited' | 'banned', { hasNextPage: boolean; fetchNextPage: () => unknown; isPending: boolean }>;
  act: { mutate: (v: { id: string; action: string; reason?: string }) => void; isPending: boolean };
  setActing: (a: null | { m: RingMemberView; action: 'remove' | 'ban'; withdraw?: boolean }) => void;
  done: () => void;
  fail: (e: unknown) => void;
}

const Who = ({ m }: { m: Pick<RingMemberView, 'handle' | 'display_name'> }) => (
  <><PersonLink app="people" to={m.handle}>{m.display_name || `@${m.handle}`}</PersonLink>{m.display_name && <span className="muted"> @{m.handle}</span>}</>
);

function RequestsTab({ ring, rows, lists, act, setActing, done, fail }: TabCtx) {
  const t = useT();
  const [invite, setInvite] = useState('');
  const doInvite = useMutation({ mutationFn: () => api.post(`/rings/${ring.slug}/invites`, { handle: invite }), onSuccess: () => { setInvite(''); done(); }, onError: fail });
  const pending = rows('pending'); const invited = rows('invited');
  return (
    <div className="ring-manage-body">
      <h4>{t('rings.manage.waiting')}</h4>
      {pending.length === 0 ? <p className="muted">{t('rings.manage.noneWaiting')}</p> : (
        <ul className="rows">{pending.map((m) => (
          <li key={m.user_id} className="row-head">
            <span><Who m={m} /></span>
            <span className="row-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => act.mutate({ id: m.user_id, action: 'approve' })}>{t('rings.manage.approve', { name: m.handle })}</button>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => setActing({ m, action: 'remove' })}>{t('rings.manage.decline', { name: m.handle })}</button>
            </span>
          </li>
        ))}</ul>
      )}
      {lists.pending.hasNextPage && <button type="button" className="btn" onClick={() => void lists.pending.fetchNextPage()}>{t('homepages.more')}</button>}
      <h4>{t('rings.manage.invited')}</h4>
      {invited.length === 0 ? <p className="muted">{t('rings.manage.noneInvited')}</p> : (
        <ul className="rows">{invited.map((m) => (
          <li key={m.user_id} className="row-head">
            <span><Who m={m} /></span>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setActing({ m, action: 'remove', withdraw: true })}>{t('rings.manage.withdraw', { name: m.handle })}</button>
          </li>
        ))}</ul>
      )}
      <form className="ring-manage-form" onSubmit={(e) => { e.preventDefault(); doInvite.mutate(); }}>
        <TextField label={t('rings.manage.invite')} value={invite} onChange={setInvite} autoCapitalize="none" spellCheck={false} required />
        <div className="actions"><button className="btn" type="submit" disabled={doInvite.isPending}>{t('rings.manage.send')}</button></div>
      </form>
    </div>
  );
}

function MembersTab({ ring, rows, lists, act, setActing, done, fail }: TabCtx) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const members = rows('member'); const banned = rows('banned');
  const order = useMutation({ mutationFn: (ids: string[]) => api.put(`/rings/${ring.slug}/order`, { user_ids: ids }), onSuccess: done, onError: fail });
  // The order sent is the loaded part of the list; members not loaded keep their place after it (core does that).
  const ids = members.map((m) => m.user_id);
  const move = (i: number, by: -1 | 1) => { const next = [...ids]; const j = i + by; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j]!, next[i]!]; order.mutate(next); };
  const f = filter.trim().toLowerCase();
  const shown = members.map((m, i) => ({ m, i })).filter(({ m }) => !f || m.handle.toLowerCase().includes(f) || (m.display_name ?? '').toLowerCase().includes(f));
  return (
    <div className="ring-manage-body">
      <TextField label={t('rings.manage.filter')} value={filter} onChange={setFilter} type="search" autoCapitalize="none" spellCheck={false} />
      <p className="hint">{t('rings.manage.orderHint')}</p>
      <ol className="rows ring-members-manage">
        {shown.map(({ m, i }) => (
          <li key={m.user_id} className="row-head">
            <span>
              <Who m={m} />
              {m.flags?.map((fl) => <span key={fl} className="badge badge-warn"> {t(`rings.manage.flag.${fl}`)}</span>)}
            </span>
            <span className="row-actions">
              <button type="button" className="btn btn-small btn-quiet" onClick={() => move(i, -1)} disabled={i === 0 || Boolean(f)} aria-label={t('rings.manage.up', { name: m.handle })}>↑</button>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => move(i, 1)} disabled={i === ids.length - 1 || Boolean(f)} aria-label={t('rings.manage.down', { name: m.handle })}>↓</button>
              {m.user_id !== ring.founder.id && (
                <>
                  <button type="button" className="btn btn-small btn-quiet" onClick={() => setActing({ m, action: 'remove' })}>{t('rings.manage.remove', { name: m.handle })}</button>
                  <button type="button" className="btn btn-small btn-quiet btn-danger" onClick={() => setActing({ m, action: 'ban' })}>{t('rings.manage.ban', { name: m.handle })}</button>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      {shown.length === 0 && f && <p className="muted">{t('rings.manage.noMatch')}</p>}
      {lists.member.hasNextPage && <button type="button" className="btn" onClick={() => void lists.member.fetchNextPage()}>{t('homepages.more')}</button>}
      {banned.length > 0 && (
        <>
          <h4>{t('rings.manage.banned')}</h4>
          <ul className="rows">{banned.map((m) => (
            <li key={m.user_id} className="row-head"><span><Who m={m} /></span>
              <button type="button" className="btn btn-small btn-quiet" onClick={() => act.mutate({ id: m.user_id, action: 'unban' })}>{t('rings.manage.unban', { name: m.handle })}</button>
            </li>
          ))}</ul>
          {lists.banned.hasNextPage && <button type="button" className="btn" onClick={() => void lists.banned.fetchNextPage()}>{t('homepages.more')}</button>}
        </>
      )}
    </div>
  );
}

function OpsTab({ ring, done, fail }: { ring: RingDetail; done: () => void; fail: (e: unknown) => void }) {
  const t = useT();
  const me = useMe().data;
  const confirm = useConfirm();
  const [opHandle, setOpHandle] = useState('');
  const [heir, setHeir] = useState('');
  const addOp = useMutation({ mutationFn: () => api.post(`/rings/${ring.slug}/ops`, { handle: opHandle }), onSuccess: () => { setOpHandle(''); done(); }, onError: fail });
  const rmOp = useMutation({ mutationFn: (id: string) => api.del(`/rings/${ring.slug}/ops/${id}`), onSuccess: done, onError: fail });
  const transfer = useMutation({ mutationFn: () => api.post(`/rings/${ring.slug}/transfer`, { handle: heir }), onSuccess: () => { setHeir(''); done(); }, onError: fail });
  const boss = Boolean(ring.me?.is_founder) || me?.role === 'admin';
  return (
    <div className="ring-manage-body">
      <ul className="rows">
        {ring.ops.map((o) => (
          <li key={o.op_id} className="row-head">
            <span><PersonLink app="people" to={o.handle}>@{o.handle}</PersonLink>{o.id === ring.founder.id && <span className="badge"> {t('rings.manage.founder')}</span>}</span>
            {(boss || o.id === me?.id) && o.id !== ring.founder.id && <button type="button" className="btn btn-small btn-quiet" onClick={() => rmOp.mutate(o.op_id)}>{t('rings.manage.removeOp', { name: o.handle })}</button>}
          </li>
        ))}
      </ul>
      {boss ? (
        <>
          <form className="ring-manage-form" onSubmit={(e) => { e.preventDefault(); addOp.mutate(); }}>
            <TextField label={t('rings.manage.addOp')} value={opHandle} onChange={setOpHandle} autoCapitalize="none" spellCheck={false} required />
            <div className="actions"><button className="btn" type="submit" disabled={addOp.isPending}>{t('rings.manage.addOpGo')}</button></div>
          </form>
          <section className="danger-zone" aria-labelledby="ring-transfer-h">
            <h4 id="ring-transfer-h">{t('rings.manage.transferTitle')}</h4>
            <form className="ring-manage-form" onSubmit={(e) => { e.preventDefault(); void confirm({ message: t('rings.manage.transferConfirm'), confirmLabel: t('confirm.handOver'), danger: true }).then((ok) => ok && transfer.mutate()); }}>
              <TextField label={t('rings.manage.transfer')} value={heir} onChange={setHeir} autoCapitalize="none" spellCheck={false} required />
              <div className="actions"><button className="btn btn-danger" type="submit" disabled={transfer.isPending}>{t('rings.manage.transferGo')}</button></div>
            </form>
          </section>
        </>
      ) : <p className="hint">{t('rings.manage.opsFounderOnly')}</p>}
    </div>
  );
}

// The ring's details. An untouched form follows changes made elsewhere (another op, a refresh); one being edited is kept.
function DetailsTab({ ring, done, fail }: { ring: RingDetail; done: () => void; fail: (e: unknown) => void }) {
  const t = useT();
  const confirm = useConfirm();
  const fromRing = () => ({ name: ring.name, description: ring.description, about: ring.about, tags: ring.tags.join(', '), join_policy: ring.join_policy });
  const [edit, setEdit] = useState(fromRing);
  const [base, setBase] = useState(fromRing);
  const now = fromRing();
  if (JSON.stringify(now) !== JSON.stringify(base)) {
    setBase(now);
    if (JSON.stringify(edit) === JSON.stringify(base)) setEdit(now);
  }
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/rings/${ring.slug}`, body), onSuccess: done, onError: fail });
  return (
    <div className="ring-manage-body">
      <form className="ring-manage-form" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...edit, tags: parseTags(edit.tags) }); }}>
        <TextField label={t('rings.form.name')} value={edit.name} onChange={(v) => setEdit((x) => ({ ...x, name: v }))} maxLength={60} required />
        <TextField label={t('rings.form.description')} value={edit.description} onChange={(v) => setEdit((x) => ({ ...x, description: v }))} maxLength={300} />
        <TextField label={t('rings.form.about')} value={edit.about} onChange={(v) => setEdit((x) => ({ ...x, about: v }))} maxLength={5000} multiline />
        <TextField label={t('rings.form.tags')} hint={t('rings.form.tagsHint')} value={edit.tags} onChange={(v) => setEdit((x) => ({ ...x, tags: v }))} />
        <div className="field">
          <label htmlFor="ring-policy-edit">{t('rings.form.policy')}</label>
          <select id="ring-policy-edit" value={edit.join_policy} onChange={(e) => setEdit((x) => ({ ...x, join_policy: e.target.value as typeof x.join_policy }))}>
            {JOIN_POLICIES.map((p) => <option key={p} value={p}>{t(`rings.policy.${p}`)}</option>)}
          </select>
        </div>
        <div className="actions"><button className="btn btn-primary" type="submit" disabled={save.isPending}>{t('rings.form.save')}</button></div>
      </form>
      <RingWikiSwitch slug={ring.slug} />
      <section className="danger-zone" aria-labelledby="ring-archive-h">
        <h4 id="ring-archive-h">{ring.archived ? t('rings.manage.unarchiveTitle') : t('rings.manage.archive')}</h4>
        <p className="hint">{t('rings.manage.archiveHint')}</p>
        <div className="actions">
          {ring.archived
            ? <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate({ archived: false })}>{t('rings.manage.unarchive')}</button>
            : <button type="button" className="btn btn-danger" disabled={save.isPending} onClick={() => void confirm({ message: t('rings.manage.archiveConfirm'), confirmLabel: t('rings.manage.archiveGo'), danger: true }).then((ok) => ok && save.mutate({ archived: true }))}>{t('rings.manage.archiveGo')}</button>}
        </div>
      </section>
    </div>
  );
}

// The ring's wiki (docs/20): a link when it is on, and for ops a switch. A wiki that is off looks like none to others.
const useRingWiki = (slug: string) => useQuery({ queryKey: ['wiki', `ring:${slug}`, 'info'], queryFn: () => api.get<WikiInfo>(`/wiki/ring:${slug}`).catch(() => null) });
function RingWikiSwitch({ slug }: { slug: string }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useRingWiki(slug);
  const [on, setOn] = useState<boolean | null>(null);
  const shown = on ?? Boolean(q.data?.enabled);
  const save = useMutation({
    mutationFn: (enabled: boolean) => api.put(`/rings/${slug}/wiki`, { enabled }),
    onSettled: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ['wiki', `ring:${slug}`] }), qc.invalidateQueries({ queryKey: ['ring', slug] })]); setOn(null); },
  });
  if (q.isPending) return null;
  return (
    <section className="panel" aria-labelledby="ring-wiki-h">
      <h3 id="ring-wiki-h">{t('rings.wiki')}</h3>
      <label className="check switch">
        <input type="checkbox" role="switch" checked={shown} disabled={save.isPending} onChange={(e) => { setOn(e.target.checked); save.mutate(e.target.checked); }} />
        <span>{t('rings.wikiOn')}</span>
      </label>
      <p className="hint">{t('rings.wikiHint')}</p>
      {save.isError && <Alert kind="error">{errorText(save.error)}</Alert>}
    </section>
  );
}

