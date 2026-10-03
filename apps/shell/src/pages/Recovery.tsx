import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { forgotPasswordSchema, passwordSchema } from '@app/shared';
import { Alert, Centered, TextField } from '../components/ui';
import { api } from '../api';
import { errorText, useT } from '../hooks';

export function VerifyEmailPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token');
  const started = useRef(false);
  const verify = useMutation({ mutationFn: (tok: string) => api.post('/auth/verify-email', { token: tok }) });

  // The link works once. React runs effects twice in development, so without this guard the second
  // run would use the token up and the page would report a failure for a link that had worked.
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(token);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Centered title={t('auth.verify.working')}>
      {!token && <Alert kind="error">{t('auth.verify.missing')}</Alert>}
      {token && verify.isPending && <p role="status">{t('auth.verify.working')}</p>}
      {verify.isSuccess && <Alert kind="success">{t('auth.verify.ok')}</Alert>}
      {verify.isError && <Alert kind="error">{t('auth.verify.failed')}</Alert>}
      {(verify.isSuccess || verify.isError || !token) && <p className="links"><Link to="/login">{t('auth.backToLogin')}</Link></p>}
    </Centered>
  );
}

// The link from "change your email" in Settings (docs/02). Works once, signed in or not.
export function ConfirmEmailPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token');
  const started = useRef(false);
  const confirm = useMutation({ mutationFn: (tok: string) => api.post('/auth/confirm-email', { token: tok }) });
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    confirm.mutate(token);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Centered title={t('auth.confirmEmail.title')}>
      {!token && <Alert kind="error">{t('auth.verify.missing')}</Alert>}
      {token && confirm.isPending && <p role="status">{t('auth.verify.working')}</p>}
      {confirm.isSuccess && <Alert kind="success">{t('auth.confirmEmail.ok')}</Alert>}
      {confirm.isError && <Alert kind="error">{errorText(confirm.error)}</Alert>}
      {(confirm.isSuccess || confirm.isError || !token) && <p className="links"><Link to="/">{t('auth.confirmEmail.back')}</Link></p>}
    </Centered>
  );
}

export function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({ mutationFn: () => api.post('/auth/forgot-password', { email }), onError: (e) => setError(errorText(e)) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!forgotPasswordSchema.safeParse({ email }).success) return setError(t('field.email'));
    send.mutate();
  };
  return (
    <Centered title={t('auth.forgot.title')}>
      {send.isSuccess ? <Alert kind="success">{t('auth.forgot.done')}</Alert> : (
        <form onSubmit={submit} noValidate>
          <TextField label={t('field.email')} value={email} onChange={setEmail} type="email" autoComplete="email" required />
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn btn-primary" type="submit" disabled={send.isPending}>{t('auth.forgot.submit')}</button>
        </form>
      )}
      <p className="links"><Link to="/login">{t('auth.backToLogin')}</Link></p>
    </Centered>
  );
}

export function ResetPasswordPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({ mutationFn: () => api.post('/auth/reset-password', { token, password }), onError: (e) => setError(errorText(e)) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    reset.mutate();
  };
  return (
    <Centered title={t('auth.reset.title')}>
      {!token && <Alert kind="error">{t('auth.reset.missing')}</Alert>}
      {token && !reset.isSuccess && (
        <form onSubmit={submit} noValidate>
          <TextField label={t('field.newPassword')} value={password} onChange={setPassword} type="password" hint={t('auth.signup.passwordHint')} autoComplete="new-password" required />
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn btn-primary" type="submit" disabled={reset.isPending}>{t('auth.reset.submit')}</button>
        </form>
      )}
      {reset.isSuccess && <Alert kind="success">{t('auth.reset.done')}</Alert>}
      <p className="links"><Link to="/login">{t('auth.backToLogin')}</Link></p>
    </Centered>
  );
}
