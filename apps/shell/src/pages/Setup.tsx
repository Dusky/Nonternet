import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSWORD_MIN, type Me } from '@app/shared';
import { Alert, Centered, Loading, TextField } from '../components/ui';
import { api } from '../api';
import { errorText, useSite, useT } from '../hooks';

// The installer's web finish (docs/19). The installer prints a link with a one-off setup token; whoever opens it makes
// the first admin. After that the page only says the site is set up, and shows the first things to do.
export function SetupPage() {
  const t = useT();
  const site = useSite();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const status = useQuery({ queryKey: ['setup'], queryFn: () => api.get<{ needed: boolean }>('/setup') });
  const [token, setToken] = useState(params.get('token') ?? '');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const finish = useMutation({
    mutationFn: () => api.post('/setup', { token: token.trim(), handle: handle.trim(), email: email.trim(), password }),
    onSuccess: async () => {
      setDone(true);
      const me = await api.get<Me>('/me').catch(() => null);
      if (me) qc.setQueryData(['me'], me);
      void qc.invalidateQueries({ queryKey: ['setup'] });
    },
  });
  const mismatch = again.length > 0 && again !== password;
  const submit = (e: FormEvent) => { e.preventDefault(); if (!mismatch) finish.mutate(); };

  if (done) {
    return (
      <Centered title={t('setup.done.title', { name: site.name })}>
        <p>{t('setup.done.lead')}</p>
        <ol className="setup-next">
          <li><Link to="/settings/security">{t('setup.done.twoFactor')}</Link></li>
          <li><Link to="/wiki">{t('setup.done.wiki')}</Link></li>
          <li><Link to="/admin">{t('setup.done.console')}</Link></li>
          <li><Link to="/">{t('setup.done.desktop')}</Link></li>
        </ol>
      </Centered>
    );
  }
  if (status.isLoading) return <Centered title={t('setup.title', { name: site.name })}><Loading rows={2} /></Centered>;
  if (!status.data?.needed) {
    return (
      <Centered title={t('setup.closed.title')}>
        <p>{t('setup.closed.body')}</p>
        <p><Link className="btn btn-primary" to="/login">{t('setup.closed.signIn')}</Link></p>
      </Centered>
    );
  }
  return (
    <Centered title={t('setup.title', { name: site.name })}>
      <p>{t('setup.lead')}</p>
      <form onSubmit={submit} noValidate>
        {!params.get('token') && <TextField label={t('setup.token')} hint={t('setup.tokenHint')} value={token} onChange={setToken} autoCapitalize="none" spellCheck={false} required />}
        <TextField label={t('field.handle')} value={handle} onChange={setHandle} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} required />
        <TextField label={t('field.email')} type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <TextField label={t('field.password')} type="password" value={password} onChange={setPassword} autoComplete="new-password" hint={t('setup.passwordHint', { min: PASSWORD_MIN })} required />
        <TextField label={t('setup.passwordAgain')} type="password" value={again} onChange={setAgain} autoComplete="new-password" required />
        {mismatch && <Alert kind="error">{t('setup.mismatch')}</Alert>}
        {finish.isError && <Alert kind="error">{errorText(finish.error)}</Alert>}
        <button type="submit" className="btn btn-primary" disabled={finish.isPending || mismatch || !handle || !email || password.length < PASSWORD_MIN || !token}>{finish.isPending ? t('setup.working') : t('setup.submit')}</button>
      </form>
    </Centered>
  );
}
