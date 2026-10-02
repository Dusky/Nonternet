import { useConfirm } from '../../components/feedback';
import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ABILITIES, type CharacterView, type DirectoryEntry, type LastSeen, type MyVouch, type PublicProfile } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, Avatar, CopyButton, EmptyState, Loading, NotFound, RelativeTime, TextField } from '../../components/ui';
import type { OnlinePerson } from '../../shell/HomePanel';
import { useDebounced } from '../admin/useDebounced';
import { errorText, formatWhen, useMe, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { useBlocks } from '../settings/Blocks';
import { AppLink, matchRoute, useAppNav, useSubtitle } from '../../nav';
import { PersonLink } from './PersonLink';

const ROUTES = ['', ':handle'] as const;

// People on the site (docs/10): anyone's public profile, with their rings and MUD characters (docs/09).
export default function PeopleApp() {
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  if (!route) return <div className="app-content"><NotFound /></div>;
  return (
    <div className="app-content">
      {route.pattern === '' ? <Find /> : <Profile handle={route.params.handle!} />}
    </div>
  );
}

function Find() {
  const t = useT();
  const nav = useAppNav();
  const me = useMe().data;
  const [handle, setHandle] = useState('');
  const online = useQuery({ queryKey: ['online'], queryFn: () => api.get<{ people: OnlinePerson[] }>('/online'), enabled: Boolean(me && me.role !== 'guest'), refetchInterval: 60_000 });
  const go = (e: FormEvent) => { e.preventDefault(); const h = handle.trim().replace(/^@/, ''); if (h) nav.go(encodeURIComponent(h)); };
  return (
    <>
      <form onSubmit={go} className="panel search-form">
        <TextField label={t('people.find')} value={handle} onChange={setHandle} hint={t('people.findHint')} maxLength={40} autoCapitalize="none" spellCheck={false} />
        <button className="btn btn-primary" type="submit">{t('people.go')}</button>
      </form>
      {me && me.role !== 'guest' && <Directory />}
      {online.data && (
        <section aria-labelledby="people-online">
          <h2 id="people-online">{t('people.online', { count: online.data.people.length })}</h2>
          {online.data.people.length === 0 ? <EmptyState icon="user">{t('people.onlineNone')}</EmptyState> : (
            <ul className="cards">
              {online.data.people.map((p) => (
                <li key={p.id} className="person-card">
                  <AppLink to={encodeURIComponent(p.handle)} className="person"><Avatar id={p.id} name={p.display_name || p.handle} /><span><strong>{p.display_name || p.handle}</strong><br /><span className="row-meta">@{p.handle}</span></span></AppLink>
                  {p.status_line && <p className="row-meta">{p.away ? `${t('people.away')} · ` : ''}{p.status_line}</p>}
                  <p className="row-meta">{[p.web && t('home.online.web'), p.chat && t('home.online.chat'), p.bbs && t('people.onBbs', { node: p.bbs.node, where: p.bbs.where })].filter(Boolean).join(' · ')}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

const lastSeenKey = (l: LastSeen) => `people.lastSeen.${l}` as StringKey;

// Everyone on the site, newest activity first, with a search box and a role filter.
function Directory() {
  const t = useT();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const term = useDebounced(q.trim(), 250);
  const list = useInfiniteQuery({
    queryKey: ['people', 'directory', term, role],
    queryFn: ({ pageParam }) => api.get<{ people: DirectoryEntry[]; next: number | null }>(`/people?${new URLSearchParams({ ...(term ? { q: term } : {}), ...(role ? { role } : {}), offset: String(pageParam) })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const people = list.data?.pages.flatMap((p) => p.people) ?? [];
  return (
    <section aria-labelledby="people-all">
      <h2 id="people-all">{t('people.directory')}</h2>
      <div className="toolbar">
        <input type="search" aria-label={t('people.search')} placeholder={t('people.search')} value={q} onChange={(e) => setQ(e.target.value)} maxLength={40} />
        <label className="inline">{t('people.role')}{' '}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t('people.anyRole')}</option>
            {(['user', 'trusted', 'admin'] as const).map((r) => <option key={r} value={r}>{t(`people.role.${r}` as StringKey)}</option>)}
          </select>
        </label>
      </div>
      {list.isError && <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>}
      {list.isPending && <Loading rows={3} />}
      {list.isSuccess && people.length === 0 && <EmptyState icon="user">{t('people.noMatch')}</EmptyState>}
      <ul className="cards">
        {people.map((p) => (
          <li key={p.id} className="person-card">
            <AppLink to={encodeURIComponent(p.handle)} className="person"><Avatar id={p.id} name={p.display_name || p.handle} /><span><strong>{p.display_name || p.handle}</strong><br /><span className="row-meta">@{p.handle}{p.role !== 'user' && <> · {t(`people.role.${p.role}` as StringKey)}</>}</span></span></AppLink>
            {(p.status_line || p.away) && <p className="row-meta">{p.away ? `${t('people.away')}${p.status_line ? ' · ' : ''}` : ''}{p.status_line}</p>}
            {p.last_seen && <p className="row-meta">{t(lastSeenKey(p.last_seen))}</p>}
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button type="button" className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('boards.more')}</button>}
    </section>
  );
}

function Profile({ handle }: { handle: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['profile', handle.toLowerCase()], queryFn: () => api.get<PublicProfile>(`/users/${encodeURIComponent(handle)}`) });
  useSubtitle(q.data ? q.data.display_name || q.data.handle : null);
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const p = q.data;
  if (!p) return <Loading />;
  return (
    <article aria-labelledby="profile-name" className="profile">
      <div className="panel profile-card">
      <header className="profile-head">
        <Avatar id={p.id} name={p.display_name || p.handle} size="lg" />
        <div>
        <h2 id="profile-name">{p.display_name || p.handle}</h2>
        <p className="muted">@{p.handle}{p.role !== 'user' && <> · <span className="badge">{t(`people.role.${p.role}` as StringKey)}</span></>} · {t('people.joined', { when: formatWhen(p.joined_at) ?? '' })}{p.last_seen && <> · {t(lastSeenKey(p.last_seen))}</>}</p>
        {(p.status_line || p.away) && <p className="profile-status">{p.away && <span className="badge">{t('people.away')}</span>} {p.status_line}</p>}
        </div>
      </header>
      {p.bio && <p className="profile-bio">{p.bio}</p>}
      <PersonActions p={p} />
      <p className="toolbar"><CopyButton text={`${window.location.origin}/people/${encodeURIComponent(p.handle)}`} label={t('people.copyLink')} /></p>
      </div>
      {p.homepage_url && (
        <p className="panel homepage-card">
          <a href={p.homepage_url} rel="noopener"><strong>{p.homepage?.title || t('people.homepage')}</strong></a>
          {p.homepage?.updated_at && <span className="muted"> · {t('people.homepageUpdated')} <RelativeTime iso={p.homepage.updated_at} /></span>}
        </p>
      )}
      {p.recent_posts.length > 0 && (
        <section aria-labelledby="profile-posts" className="panel">
          <div className="panel-head"><h3 id="profile-posts">{t('people.recentPosts')}</h3></div>
          <ul className="rows">
            {p.recent_posts.map((x) => (
              <li key={x.id}><PersonLink app="boards" to={`${x.board.slug}/t/${x.thread_id}`}>{x.subject || t('people.untitled')}</PersonLink> <span className="muted">· {x.board.name} · <RelativeTime iso={x.posted_at} /></span></li>
            ))}
          </ul>
        </section>
      )}
      {p.rings.length > 0 && (
        <section aria-labelledby="profile-rings">
          <h3 id="profile-rings">{t('people.rings')}</h3>
          <ul className="ring-tags">{p.rings.map((r) => <li key={r.slug}><PersonLink app="rings" to={r.slug}>{r.name}</PersonLink></li>)}</ul>
        </section>
      )}
      <section aria-labelledby="profile-chars">
        <h3 id="profile-chars">{t('people.characters')}</h3>
        {p.characters.length === 0 ? <p className="muted">{t('people.noCharacters')}</p> : (
          <ul className="char-cards">{p.characters.map((c) => <CharacterCard key={c.id} c={c} featured={c.id === p.featured_character_id} />)}</ul>
        )}
      </section>
    </article>
  );
}

function CharacterCard({ c, featured }: { c: CharacterView; featured: boolean }) {
  const t = useT();
  return (
    <li className={`char-card${featured ? ' is-featured' : ''}`} aria-label={t('people.characterLabel', { name: c.name, level: c.level })}>
      <h4>{c.name} {featured && <span className="badge">{t('people.featured')}</span>}</h4>
      <p className="muted">{t('people.level', { level: c.level })} · {t('people.hp', { hp: c.hp, max: c.hp_max })} · {t('people.coins', { coins: c.coins })}</p>
      <dl className="abilities">
        {ABILITIES.map((a) => <div key={a}><dt>{t(`people.ability.${a}` as StringKey)}</dt><dd>{c.abilities[a] >= 0 ? `+${c.abilities[a]}` : c.abilities[a]}</dd></div>)}
      </dl>
    </li>
  );
}

// Mail and block, for signed-in, confirmed people looking at someone else.
function PersonActions({ p }: { p: PublicProfile }) {
  const t = useT();
  const confirm = useConfirm();
  const me = useMe().data;
  const qc = useQueryClient();
  const mine = Boolean(me && me.role !== 'guest' && me.id !== p.id);
  const blocks = useBlocks();
  const blocked = Boolean(blocks.data?.blocks.some((b) => b.handle.toLowerCase() === p.handle.toLowerCase()));
  const toggle = useMutation({
    mutationFn: () => api.post(blocked ? '/me/blocks/remove' : '/me/blocks', { handle: p.handle }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['me', 'blocks'] }); void qc.invalidateQueries({ queryKey: ['mail'] }); },
  });
  if (!mine) return null;
  return (
    <div className="toolbar">
      {!blocked && <OpenAppLink app="mail" to={`new/${encodeURIComponent(p.handle)}`} className="btn">{t('mail.write')}</OpenAppLink>}
      {p.role !== 'admin' && (
        <button type="button" className="btn btn-quiet" disabled={toggle.isPending || !blocks.data}
          onClick={() => { if (blocked) toggle.mutate(); else void confirm({ message: t('blocks.blockConfirm', { handle: p.handle }), confirmLabel: t('confirm.block'), danger: true }).then((ok) => ok && toggle.mutate()); }}>
          {blocked ? t('blocks.unblock') : t('blocks.block')}
        </button>
      )}
      {blocked && <span className="muted">{t('blocks.blocked')}</span>}
      {toggle.isError && <Alert kind="error">{errorText(toggle.error)}</Alert>}
      {(me!.role === 'trusted' || me!.role === 'admin') && p.role === 'user' && <Vouch handle={p.handle} />}
    </div>
  );
}

// Trusted people can vouch for a user; two vouches put them in front of the admins (docs/03).
function Vouch({ handle }: { handle: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const mine = useQuery({ queryKey: ['me', 'vouches'], queryFn: () => api.get<{ vouches: MyVouch[] }>('/me/vouches') });
  const done = Boolean(mine.data?.vouches.some((v) => v.handle.toLowerCase() === handle.toLowerCase()));
  const refresh = () => { setOpen(false); void qc.invalidateQueries({ queryKey: ['me', 'vouches'] }); };
  const send = useMutation({ mutationFn: () => api.post('/vouches', { handle, note }), onSuccess: refresh });
  const withdraw = useMutation({ mutationFn: () => api.post('/vouches/withdraw', { handle }), onSuccess: refresh });
  if (!mine.data) return null;
  if (done) return (
    <p className="vouch">
      <span role="status">{t('vouch.done')}</span>{' '}
      <button type="button" className="link" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>{t('vouch.withdraw')}</button>
      {withdraw.isError && <Alert kind="error">{errorText(withdraw.error)}</Alert>}
    </p>
  );
  return (
    <>
      <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{t('vouch.button', { handle })}</button>
      {open && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <TextField label={t('vouch.note')} value={note} onChange={setNote} maxLength={500} multiline />
          {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
          <button type="submit" className="btn btn-primary" disabled={send.isPending}>{t('vouch.send')}</button>
        </form>
      )}
    </>
  );
}
