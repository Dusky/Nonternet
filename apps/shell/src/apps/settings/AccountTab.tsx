import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HANDLE_PATTERN, type Me } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, formatWhen, useSite, useT } from '../../hooks';
import { Section } from './Section';

// Changing your email address (docs/02). A link goes to the new address; nothing changes until it is opened.
export function EmailAddress({ me }: { me: Me }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api.post('/me/email', { email, password }),
    onSuccess: () => { setSentTo(email); setEmail(''); setPassword(''); },
  });
  return (
    <Section id="email-h" title={t('settings.email.title')} scope="account">
      <p>{t('settings.email.current', { email: me.email })}</p>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); change.mutate(); }}>
        <TextField label={t('settings.email.new')} value={email} onChange={setEmail} type="email" autoComplete="email" required />
        <TextField label={t('field.currentPassword')} value={password} onChange={setPassword} type="password" autoComplete="current-password" required />
        {change.error && <Alert kind="error">{errorText(change.error)}</Alert>}
        {sentTo && !change.error && <Alert kind="success">{t('settings.email.sent', { email: sentTo })}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={change.isPending || !email || !password}>{t('settings.email.submit')}</button>
      </form>
    </Section>
  );
}

// Changing your handle (docs/02, docs/07): once every 90 days. The old homepage address redirects for 90 days.
export function Handle({ me }: { me: Me }) {
  const t = useT();
  const site = useSite();
  const qc = useQueryClient();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const when = useQuery({ queryKey: ['me', 'handle'], queryFn: () => api.get<{ changeable_at: string | null }>('/me/handle') });
  const change = useMutation({
    mutationFn: () => api.post('/me/handle', { handle, password }),
    onSuccess: () => { setHandle(''); setPassword(''); void qc.invalidateQueries({ queryKey: ['me'] }); },
  });
  const next = when.data?.changeable_at;
  const valid = HANDLE_PATTERN.test(handle);
  return (
    <Section id="handle-h" title={t('settings.handle.title')} scope="account">
      <p>{t('settings.handle.current', { handle: me.handle })}</p>
      <p className="hint">{t('settings.handle.rules')}</p>
      {change.isSuccess && <Alert kind="success">{t('settings.handle.done')}</Alert>}
      {next ? <p>{t('settings.handle.next', { when: formatWhen(next) ?? '' })}</p> : (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); change.mutate(); }}>
          <TextField label={t('settings.handle.new')} value={handle} onChange={setHandle} autoComplete="username" maxLength={20} required
            hint={valid ? t('settings.handle.preview', { address: `${handle.toLowerCase()}.${site.homes_domain}` }) : t('auth.signup.handleHint')} />
          <TextField label={t('field.currentPassword')} value={password} onChange={setPassword} type="password" autoComplete="current-password" required />
          {change.error && <Alert kind="error">{errorText(change.error)}</Alert>}
          <button className="btn btn-primary" type="submit" disabled={change.isPending || !valid || !password}>{t('settings.handle.submit')}</button>
        </form>
      )}
    </Section>
  );
}
