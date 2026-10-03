import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@app/shared';
import { Alert, Centered, TextField } from '../components/ui';
import { api, ApiError } from '../api';
import { errorText, useMe, useSite, useT } from '../hooks';
import { safeReturnTo } from '../returnTo';

type Step = 'password' | 'totp' | 'recovery';

export function LoginPage() {
  const t = useT();
  const site = useSite();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const me = useMe();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('password');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Where to go once signed in: an admin who still has to set up two-factor goes there first, then
  // back to where they were headed (`return_to`, checked so it can only be this site).
  // At most once. Two triggers reach here on a successful login (the form's success handler and the
  // effect that notices the signed-in user), and a second full-page navigation to a service's
  // one-time sign-in address would cancel the first and could use the sign-in up twice.
  const proceeded = useRef(false);
  const proceed = (user: Me) => {
    if (proceeded.current) return;
    proceeded.current = true;
    if (user.limited) return navigate('/setup-2fa', { replace: true });
    const dest = safeReturnTo(params.get('return_to'), window.location.origin);
    if (!dest) return navigate('/', { replace: true });
    if (dest.kind === 'page') return window.location.assign(dest.url);
    return navigate(dest.to, { replace: true });
  };

  useEffect(() => { if (me.data) proceed(me.data); }, [me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useMutation({
    mutationFn: () => api.post<{ user: Me }>('/auth/login', {
      identifier, password,
      ...(step === 'totp' ? { totp: code.trim() } : {}),
      ...(step === 'recovery' ? { recovery_code: recovery.trim() } : {}),
    }),
    onSuccess: ({ user }) => { qc.setQueryData(['me'], user); proceed(user); },
    onError: (err) => {
      // The account has two-factor on: ask for the code next, keeping what was typed.
      if (err instanceof ApiError && err.code === 'totp_required') { setStep('totp'); setError(null); return; }
      setError(errorText(err));
    },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); login.mutate(); };
  const second = step !== 'password';

  return (
    <Centered title={t('auth.login.title')}>
      <form onSubmit={submit} noValidate>
        {!second && (
          <>
            <TextField label={t('field.identifier')} value={identifier} onChange={setIdentifier} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
            <TextField label={t('field.password')} value={password} onChange={setPassword} type="password" autoComplete="current-password" required />
          </>
        )}
        {step === 'totp' && (
          <>
            <p>{t('auth.totp.prompt')}</p>
            <TextField label={t('field.code')} value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required />
            <button type="button" className="link" onClick={() => { setStep('recovery'); setError(null); }}>{t('auth.totp.useRecovery')}</button>
          </>
        )}
        {step === 'recovery' && (
          <>
            <TextField label={t('field.recoveryCode')} value={recovery} onChange={setRecovery} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={11} autoFocus required />
            <button type="button" className="link" onClick={() => { setStep('totp'); setError(null); }}>{t('auth.totp.useCode')}</button>
          </>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={login.isPending}>{login.isPending ? t('common.working') : t('auth.login.submit')}</button>
      </form>
      <p className="links">
        <Link to="/forgot-password">{t('auth.login.forgot')}</Link>
        <Link to="/signup">{t('auth.login.needAccount')}</Link>
      </p>
    </Centered>
  );
}
