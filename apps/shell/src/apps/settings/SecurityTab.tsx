import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changePasswordSchema, type Me } from '@app/shared';
import { api } from '../../api';
import { Alert, CopyButton, TextField } from '../../components/ui';
import { Field, Form, useZodForm } from '../../components/Form';
import { errorText, useT } from '../../hooks';
import { Section } from './Section';
import { TotpSetup } from '../../pages/Setup2fa';

export function Password() {
  const t = useT();
  const [changed, setChanged] = useState(false);
  const f = useZodForm({
    schema: changePasswordSchema,
    defaultValues: { current_password: '', new_password: '' },
    submit: (v) => api.put('/me/password', v),
    onDone: () => { setChanged(true); f.form.reset(); },
  });
  return (
    <Section id="password-h" title={t('settings.tab.password')} scope="account">
      <Form f={f} submitLabel={t('settings.tab.password')} extra={changed && !f.serverError ? <Alert kind="success">{t('settings.password.changed')}</Alert> : null}>
        <Field f={f} name="current_password" label={t('field.currentPassword')} type="password" autoComplete="current-password" onInput={() => setChanged(false)} />
        <Field f={f} name="new_password" label={t('field.newPassword')} type="password" hint={t('auth.signup.passwordHint')} autoComplete="new-password" onInput={() => setChanged(false)} />
      </Form>
    </Section>
  );
}

export function TwoFactor({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inSetup, setInSetup] = useState(false);
  const regen = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] }>('/me/totp/recovery-codes', { code }),
    onSuccess: (r) => { setCodes(r.recovery_codes); setCode(''); void qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => setError(errorText(e)),
  });

  // Stay on the setup until the person has seen their recovery codes, even after /me says two-factor is on.
  if (!me.totp_enabled || inSetup) {
    return (
      <Section id="twofa-h" title={t('settings.tab.twofa')} scope="account">
        {!me.totp_enabled && <p>{t('settings.twofa.off')}</p>}
        <TotpSetup onStart={() => setInSetup(true)} onDone={() => { setInSetup(false); void qc.invalidateQueries({ queryKey: ['me'] }); }} />
      </Section>
    );
  }
  return (
    <Section id="twofa-h" title={t('settings.tab.twofa')} scope="account">
      <p>{t('settings.twofa.on')}</p>
      <p>{t('settings.twofa.codesLeft', { count: me.recovery_codes_remaining })}</p>
      {codes ? (
        <section aria-labelledby="new-codes">
          <h3 id="new-codes">{t('twofa.codes.title')}</h3>
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
      {!codes && <TurnOff />}
    </Section>
  );
}

// Turning two-factor off: the password and a current code (or a recovery code). Other sessions are signed out.
function TurnOff() {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const off = useMutation({
    mutationFn: () => api.post('/me/totp/disable', { password, ...(code.includes('-') ? { recovery_code: code } : { totp: code }) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
  if (!open) return <p><button type="button" className="btn btn-quiet" onClick={() => setOpen(true)}>{t('settings.twofa.turnOff')}</button></p>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); off.mutate(); }} aria-labelledby="twofa-off-h">
      <h3 id="twofa-off-h">{t('settings.twofa.turnOff')}</h3>
      <p className="hint">{t('settings.twofa.turnOffHint')}</p>
      <TextField label={t('field.currentPassword')} value={password} onChange={setPassword} type="password" autoComplete="current-password" required />
      <TextField label={t('settings.twofa.codeOrRecovery')} value={code} onChange={setCode} autoComplete="one-time-code" maxLength={11} required />
      {off.error && <Alert kind="error">{errorText(off.error)}</Alert>}
      <div className="toolbar">
        <button className="btn btn-danger" type="submit" disabled={off.isPending || !password || code.length < 6}>{t('settings.twofa.turnOffGo')}</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
