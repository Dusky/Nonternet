import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changePasswordSchema, type Me } from '@app/shared';
import { api } from '../../api';
import { Alert, CopyButton, TextField } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { TotpSetup } from '../../pages/Setup2fa';

export function Password() {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api.put('/me/password', { current_password: current, new_password: next }),
    onSuccess: () => { setCurrent(''); setNext(''); },
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = changePasswordSchema.safeParse({ current_password: current, new_password: next });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    change.mutate();
  };
  return (
    <form onSubmit={submit} noValidate>
      <TextField label={t('field.currentPassword')} value={current} onChange={setCurrent} type="password" autoComplete="current-password" required />
      <TextField label={t('field.newPassword')} value={next} onChange={setNext} type="password" hint={t('auth.signup.passwordHint')} autoComplete="new-password" required />
      {error && <Alert kind="error">{error}</Alert>}
      {change.isSuccess && !error && <Alert kind="success">{t('settings.password.changed')}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={change.isPending}>{t('settings.tab.password')}</button>
    </form>
  );
}

export function TwoFactor({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const regen = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] }>('/me/totp/recovery-codes', { code }),
    onSuccess: (r) => { setCodes(r.recovery_codes); setCode(''); void qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => setError(errorText(e)),
  });

  if (!me.totp_enabled) {
    return (
      <>
        <p>{t('settings.twofa.off')}</p>
        <TotpSetup onDone={() => void qc.invalidateQueries({ queryKey: ['me'] })} />
      </>
    );
  }
  return (
    <>
      <p>{t('settings.twofa.on')}</p>
      <p>{t('settings.twofa.codesLeft', { count: me.recovery_codes_remaining })}</p>
      {codes ? (
        <section aria-labelledby="new-codes">
          <h2 id="new-codes">{t('twofa.codes.title')}</h2>
          <p>{t('twofa.codes.body')}</p>
          <ul className="codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          <CopyButton text={codes.join('\n')} />
        </section>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setError(null); regen.mutate(); }}>
          <TextField label={t('field.code')} value={code} onChange={setCode} hint={t('settings.twofa.regenHint')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn" type="submit" disabled={regen.isPending || code.length !== 6}>{t('settings.twofa.regen')}</button>
        </form>
      )}
    </>
  );
}
