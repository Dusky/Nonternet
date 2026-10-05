import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { forgotPasswordSchema, resetPasswordSchema } from '@app/shared';
import { Alert, Centered } from '../components/ui';
import { Field, Form, useZodForm } from '../components/Form';
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
  const [sent, setSent] = useState(false);
  const f = useZodForm({
    schema: forgotPasswordSchema,
    defaultValues: { email: '' },
    submit: (v) => api.post('/auth/forgot-password', v),
    onDone: () => setSent(true),
  });
  return (
    <Centered title={t('auth.forgot.title')}>
      {sent ? <Alert kind="success">{t('auth.forgot.done')}</Alert> : (
        <Form f={f} submitLabel={t('auth.forgot.submit')}>
          <Field f={f} name="email" label={t('field.email')} type="email" autoComplete="email" />
        </Form>
      )}
      <p className="links"><Link to="/login">{t('auth.backToLogin')}</Link></p>
    </Centered>
  );
}

export function ResetPasswordPage() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [done, setDone] = useState(false);
  const f = useZodForm({
    schema: resetPasswordSchema,
    defaultValues: { token: token ?? '', password: '' },
    submit: (v) => api.post('/auth/reset-password', v),
    onDone: () => setDone(true),
  });
  return (
    <Centered title={t('auth.reset.title')}>
      {!token && <Alert kind="error">{t('auth.reset.missing')}</Alert>}
      {token && !done && (
        <Form f={f} submitLabel={t('auth.reset.submit')}>
          <Field f={f} name="password" label={t('field.newPassword')} type="password" hint={t('auth.signup.passwordHint')} autoComplete="new-password" />
        </Form>
      )}
      {done && <Alert kind="success">{t('auth.reset.done')}</Alert>}
      <p className="links"><Link to="/login">{t('auth.backToLogin')}</Link></p>
    </Centered>
  );
}
