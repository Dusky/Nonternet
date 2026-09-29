import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Alert, CopyButton, TextField } from '../components/ui';
import { api } from '../api';
import { errorText, useT } from '../hooks';

// Turning on two-factor: scan or type the key, prove it with a code, then save the recovery codes.
// The recovery codes are shown once, so the person must say they have saved them before moving on.
export function TotpSetup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const start = useMutation({ mutationFn: () => api.post<{ secret: string; otpauth_url: string }>('/me/totp/setup') });
  const enable = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] }>('/me/totp/enable', { code }),
    onSuccess: (r) => { setCodes(r.recovery_codes); void qc.invalidateQueries({ queryKey: ['me'] }); },
  });

  useEffect(() => { if (!start.isPending && !start.data && !start.isError) start.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (start.data) void QRCode.toDataURL(start.data.otpauth_url, { margin: 1, width: 200 }).then(setQr);
  }, [start.data]);

  if (codes) {
    return (
      <section aria-labelledby="codes-title">
        <h2 id="codes-title">{t('twofa.codes.title')}</h2>
        <p>{t('twofa.codes.body')}</p>
        <ul className="codes" aria-label={t('twofa.codes.title')}>{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        <CopyButton text={codes.join('\n')} />
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> {t('twofa.codes.saved')}
        </label>
        <button className="btn btn-primary" disabled={!saved} onClick={onDone}>{t('common.continue')}</button>
      </section>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); enable.mutate(); }}>
      {start.isError && <Alert kind="error">{errorText(start.error)}</Alert>}
      {start.data && (
        <>
          <p>{t('twofa.scan')}</p>
          {qr && <img className="qr" src={qr} width={200} height={200} alt={t('twofa.qrAlt')} />}
          <p><span className="hint">{t('twofa.key')}</span> <code className="secret">{start.data.secret}</code></p>
          <TextField label={t('twofa.enter')} value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required />
          {enable.isError && <Alert kind="error">{errorText(enable.error)}</Alert>}
          <button className="btn btn-primary" type="submit" disabled={enable.isPending || code.length !== 6}>{t('twofa.enable')}</button>
        </>
      )}
    </form>
  );
}

// The full-page version, used when an admin is stopped until two-factor is on.
export function Setup2faPage({ onDone }: { onDone: () => void }) {
  const t = useT();
  return (
    <main className="center" id="main">
      <div className="card">
        <h1>{t('twofa.title')}</h1>
        <p>{t('twofa.required')}</p>
        <TotpSetup onDone={onDone} />
      </div>
    </main>
  );
}
