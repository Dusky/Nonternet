import { useConfirm } from '../../components/feedback';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ABILITIES, type CharacterView, type MyVouch, type PublicProfile } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, Avatar, EmptyState, Loading, NotFound, TextField } from '../../components/ui';
import type { OnlinePerson } from '../../shell/HomePanel';
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
      {online.data && (
        <section aria-labelledby="people-online">
          <h2 id="people-online">{t('people.online', { count: online.data.people.length })}</h2>
          {online.data.people.length === 0 ? <EmptyState icon="user">{t('people.onlineNone')}</EmptyState> : (
            <ul className="cards">
              {online.data.people.map((p) => (
                <li key={p.id} className="person-card">
                  <AppLink to={encodeURIComponent(p.handle)} className="person"><Avatar id={p.id} name={p.display_name || p.handle} /><span><strong>{p.display_name || p.handle}</strong><br /><span className="row-meta">@{p.handle}</span></span></AppLink>
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

function Profile({ handle }: { handle: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['profile', handle.toLowerCase()], queryFn: () => api.get<PublicProfile>(`/users/${encodeURIComponent(handle)}`) });
  useSubtitle(q.data ? q.data.display_name || q.data.handle : null);
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const p = q.data;
  if (!p) return <Loading />;
  return (
    <article aria-labelledby="profile-name">
      <header className="profile-head">
        <Avatar id={p.id} name={p.display_name || p.handle} size="lg" />
        <div>
        <h2 id="profile-name">{p.display_name || p.handle}</h2>
        <p className="muted">@{p.handle}{p.role !== 'user' && <> · <span className="badge">{t(`people.role.${p.role}` as StringKey)}</span></>} · {t('people.joined', { when: formatWhen(p.joined_at) ?? '' })}</p>
        </div>
      </header>
      {p.bio && <p className="profile-bio">{p.bio}</p>}
      <PersonActions p={p} />
      {p.homepage_url && <p><a href={p.homepage_url} rel="noopener">{t('people.homepage')}</a></p>}
      {p.rings.length > 0 && (
        <section aria-labelledby="profile-rings">
          <h3 id="profile-rings">{t('people.rings')}</h3>
          <ul className="inline-list">{p.rings.map((r) => <li key={r.slug}><PersonLink app="rings" to={r.slug}>{r.name}</PersonLink></li>)}</ul>
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
