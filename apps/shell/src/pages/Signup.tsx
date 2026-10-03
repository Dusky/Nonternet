import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { APPLICATION_MAX, signupInputSchema } from '@app/shared';
import { Alert, Centered, TextField } from '../components/ui';
import { api, ApiError } from '../api';
import { errorText, useSite, useT } from '../hooks';

type Errors = Partial<Record<'handle' | 'email' | 'password' | 'invite' | 'display_name' | 'age' | 'application', string>>;

export function SignupPage() {
  const t = useT();
  const site = useSite();
  const [params] = useSearchParams();
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [invite, setInvite] = useState(params.get('invite') ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [age, setAge] = useState(false);
  const [application, setApplication] = useState('');
  const [done, setDone] = useState(false);
  const inviteOnly = site.signup_mode === 'invite';
  const byApplication = site.signup_mode === 'application';
  const asksAge = site.minimum_age > 0;

  const signup = useMutation({
    mutationFn: (body: object) => api.post('/auth/signup', body),
    onSuccess: () => setDone(true),
    onError: (err) => {
      // Point at the field the server is unhappy about, when there is one.
      if (err instanceof ApiError) {
        if (err.code === 'handle_unavailable') return setErrors({ handle: err.message });
        if (err.code === 'email_taken') return setErrors({ email: err.message });
        if (err.code === 'age_required') return setErrors({ age: err.message });
        if (err.code === 'application_required') return setErrors({ application: err.message });
        if (err.code === 'invite_invalid' || err.code === 'invite_required') return setErrors({ invite: err.message });
      }
      setFormError(errorText(err));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    // The same rules the server applies, so most mistakes are caught before anything is sent.
    const parsed = signupInputSchema.safeParse({
      handle, email, password,
      ...(displayName.trim() ? { display_name: displayName } : {}),
      ...(inviteOnly ? { invite } : {}),
      ...(asksAge ? { age_confirmed: age } : {}),
      ...(byApplication ? { application } : {}),
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as keyof Errors] ??= issue.message;
      return setErrors(next);
    }
    if (asksAge && !age) return setErrors({ age: t('auth.signup.ageError') });
    if (byApplication && !application.trim()) return setErrors({ application: t('auth.signup.applicationError') });
    setErrors({});
    signup.mutate(parsed.data);
  };

  if (done) {
    return <Centered title={t('auth.signup.title')}><Alert kind="success">{t(byApplication ? 'auth.signup.applied' : 'auth.signup.done')}</Alert><p className="links"><Link to="/login">{t('auth.backToLogin')}</Link></p></Centered>;
  }

  return (
    <Centered title={t('auth.signup.title')}>
      <form onSubmit={submit} noValidate>
        {inviteOnly && <TextField label={t('field.invite')} value={invite} onChange={setInvite} hint={t('auth.signup.inviteHint')} error={errors.invite} autoCapitalize="characters" autoComplete="off" spellCheck={false} required />}
        <TextField label={t('field.handle')} value={handle} onChange={setHandle} hint={t('auth.signup.handleHint')} error={errors.handle} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} required />
        <TextField label={t('field.email')} value={email} onChange={setEmail} type="email" error={errors.email} autoComplete="email" required />
        <TextField label={t('field.password')} value={password} onChange={setPassword} type="password" hint={t('auth.signup.passwordHint')} error={errors.password} autoComplete="new-password" required />
        <TextField label={t('field.displayName')} value={displayName} onChange={setDisplayName} error={errors.display_name} maxLength={60} />
        {byApplication && <TextField label={t('auth.signup.application')} value={application} onChange={setApplication} hint={t('auth.signup.applicationHint')} error={errors.application} multiline maxLength={APPLICATION_MAX} required />}
        {asksAge && (
          <div className="field">
            <label className="check"><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} aria-describedby={errors.age ? 'age-error' : undefined} aria-invalid={errors.age ? true : undefined} />{t('auth.signup.age', { age: site.minimum_age })}</label>
            {errors.age && <p className="field-error" id="age-error">{errors.age}</p>}
          </div>
        )}
        <p className="hint">{t('auth.signup.legalBefore')}<Link to="/legal/terms" target="_blank">{t('legal.terms')}</Link>{t('auth.signup.legalAnd')}<Link to="/legal/privacy" target="_blank">{t('legal.privacy')}</Link>.</p>
        {formError && <Alert kind="error">{formError}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={signup.isPending}>{signup.isPending ? t('common.working') : t('auth.signup.submit')}</button>
      </form>
      <p className="links"><Link to="/login">{t('auth.signup.haveAccount')}</Link></p>
    </Centered>
  );
}
