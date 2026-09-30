import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ABILITIES, type CharacterView, type PublicProfile } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { matchRoute, useAppNav } from '../../nav';
import { PersonLink } from './PersonLink';

const ROUTES = ['', ':handle'] as const;

// People on the site (docs/10): anyone's public profile, with their rings and MUD characters (docs/09).
export default function PeopleApp() {
  const nav = useAppNav();
  const t = useT();
  const route = matchRoute(nav.path, ROUTES);
  if (!route) return <p className="pad">{t('error.notFound')}</p>;
  return (
    <div className="app-content">
      {route.pattern === '' ? <Find /> : <Profile handle={route.params.handle!} />}
    </div>
  );
}

function Find() {
  const t = useT();
  const nav = useAppNav();
  const [handle, setHandle] = useState('');
  const go = (e: FormEvent) => { e.preventDefault(); const h = handle.trim().replace(/^@/, ''); if (h) nav.go(encodeURIComponent(h)); };
  return (
    <form onSubmit={go} className="panel">
      <TextField label={t('people.find')} value={handle} onChange={setHandle} hint={t('people.findHint')} maxLength={40} autoCapitalize="none" spellCheck={false} />
      <button className="btn btn-primary" type="submit">{t('people.go')}</button>
    </form>
  );
}

function Profile({ handle }: { handle: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['profile', handle.toLowerCase()], queryFn: () => api.get<PublicProfile>(`/users/${encodeURIComponent(handle)}`) });
  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  const p = q.data;
  if (!p) return <p className="pad">{t('common.loading')}</p>;
  return (
    <article aria-labelledby="profile-name">
      <header className="profile-head">
        <h2 id="profile-name">{p.display_name || p.handle}</h2>
        <p className="muted">@{p.handle}{p.role !== 'user' && <> · <span className="badge">{t(`people.role.${p.role}` as StringKey)}</span></>} · {t('people.joined', { when: formatWhen(p.joined_at) ?? '' })}</p>
      </header>
      {p.bio && <p className="profile-bio">{p.bio}</p>}
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
