import { useToast } from '../../components/feedback';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileUpdateSchema, type CharacterView, type Me } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { Section } from './Section';
import { errorText, useT } from '../../hooks';

export function Profile({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me.display_name ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.patch<{ user: Me }>('/me', body),
    onSuccess: ({ user }) => { qc.setQueryData(['me'], user); toast(t('settings.profile.saved')); },
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = profileUpdateSchema.safeParse({ display_name: displayName, bio });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    save.mutate(parsed.data);
  };
  return (
    <Section id="profile-h" title={t('settings.tab.profile')} scope="account">
    <form onSubmit={submit} noValidate>
      <TextField label={t('field.displayName')} value={displayName} onChange={setDisplayName} maxLength={60} />
      <TextField label={t('field.bio')} value={bio} onChange={setBio} multiline maxLength={500} />
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={save.isPending}>{t('common.save')}</button>
    </form>
    </Section>
  );
}

// Which MUD character shows beside your name around the site (docs/09).
export function FeaturedCharacter() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'characters'], queryFn: () => api.get<{ characters: CharacterView[]; featured_character_id: string | null }>('/me/characters') });
  const save = useMutation({
    mutationFn: (id: string | null) => api.put('/me/featured-character', { character_id: id }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['me', 'characters'] }); void qc.invalidateQueries({ queryKey: ['profile'] }); },
  });
  if (!q.data) return null;
  return (
    <Section id="featured-h" title={t('settings.featured')} scope="account">
      {q.data.characters.length === 0 ? <p className="muted">{t('settings.featuredEmpty')}</p> : (
        <div className="field">
          <label htmlFor="featured-char">{t('settings.featuredPick')}</label>
          <select id="featured-char" aria-describedby="featured-hint" value={q.data.featured_character_id ?? ''} disabled={save.isPending}
            onChange={(e) => save.mutate(e.target.value || null)}>
            <option value="">{t('settings.featuredNone')}</option>
            {q.data.characters.map((c) => <option key={c.id} value={c.id}>{t('people.characterLabel', { name: c.name, level: c.level })}</option>)}
          </select>
          <p className="hint" id="featured-hint">{t('settings.featuredHint')}</p>
          {save.isSuccess && <p role="status" className="hint">{t('settings.featuredSaved')}</p>}
          {save.isError && <Alert kind="error">{errorText(save.error)}</Alert>}
        </div>
      )}
    </Section>
  );
}
