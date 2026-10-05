import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { APPLICATION_MAX, signupInputSchema } from '@app/shared';
import { Alert, Centered } from '../components/ui';
import { CheckField, Field, fieldMessages, Form, useZodForm } from '../components/Form';
import { api } from '../api';
import { useSite, useT } from '../hooks';

type Values = { handle: string; email: string; password: string; display_name: string; invite: string; age: boolean; application: string };

export function SignupPage() {
  const t = useT();
  const site = useSite();
  const [params] = useSearchParams();
  const [done, setDone] = useState(false);
  const inviteOnly = site.signup_mode === 'invite';
  const byApplication = site.signup_mode === 'application';
  const asksAge = site.minimum_age > 0;

  // What is sent: only the fields this site asks for.
  const body = (v: Values) => ({
    handle: v.handle, email: v.email, password: v.password,
    ...(v.display_name.trim() ? { display_name: v.display_name } : {}),
    ...(inviteOnly ? { invite: v.invite } : {}),
    ...(asksAge ? { age_confirmed: v.age } : {}),
    ...(byApplication ? { application: v.application } : {}),
  });
  const f = useZodForm<Values>({
    defaultValues: { handle: '', email: '', password: '', display_name: '', invite: params.get('invite') ?? '', age: false, application: '' },
    // The same rules the server applies, so most mistakes are caught before anything is sent.
    validate: (v) => {
      const found = fieldMessages(signupInputSchema.safeParse(body(v))) ?? {};
      if (asksAge && !v.age) found.age_confirmed = t('auth.signup.ageError');
      if (byApplication && !v.application.trim()) found.application = t('auth.signup.applicationError');
      if (inviteOnly && !v.invite.trim()) found.invite = found.invite ?? t('auth.signup.inviteError');
      // the schema names the age field age_confirmed; the form calls it age
      if (found.age_confirmed) { found.age = found.age_confirmed; delete found.age_confirmed; }
      return Object.keys(found).length ? found : undefined;
    },
    // Point at the field the server is unhappy about, when there is one.
    serverFields: { handle_unavailable: 'handle', email_taken: 'email', age_required: 'age', application_required: 'application', invite_invalid: 'invite', invite_required: 'invite' },
    submit: (v) => api.post('/auth/signup', body(v)),
    onDone: () => setDone(true),
  });

  if (done) {
    return <Centered title={t('auth.signup.title')}><Alert kind="success">{t(byApplication ? 'auth.signup.applied' : 'auth.signup.done')}</Alert><p className="links"><Link to="/login">{t('auth.backToLogin')}</Link></p></Centered>;
  }

  return (
    <Centered title={t('auth.signup.title')}>
      <Form f={f} submitLabel={t('auth.signup.submit')} extra={
        <p className="hint">{t('auth.signup.legalBefore')}<Link to="/legal/terms" target="_blank">{t('legal.terms')}</Link>{t('auth.signup.legalAnd')}<Link to="/legal/privacy" target="_blank">{t('legal.privacy')}</Link>.</p>
      }>
        {inviteOnly && <Field f={f} name="invite" label={t('field.invite')} hint={t('auth.signup.inviteHint')} autoCapitalize="characters" autoComplete="off" spellCheck={false} />}
        <Field f={f} name="handle" label={t('field.handle')} hint={t('auth.signup.handleHint')} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} />
        <Field f={f} name="email" label={t('field.email')} type="email" autoComplete="email" />
        <Field f={f} name="password" label={t('field.password')} type="password" hint={t('auth.signup.passwordHint')} autoComplete="new-password" />
        <Field f={f} name="display_name" label={t('field.displayName')} maxLength={60} />
        {byApplication && <Field f={f} name="application" label={t('auth.signup.application')} hint={t('auth.signup.applicationHint')} multiline maxLength={APPLICATION_MAX} />}
        {asksAge && <CheckField f={f} name="age" label={t('auth.signup.age', { age: site.minimum_age })} />}
      </Form>
      <p className="links"><Link to="/login">{t('auth.signup.haveAccount')}</Link></p>
    </Centered>
  );
}
