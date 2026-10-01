import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Alert } from '../components/ui';
import { errorText, useT } from '../hooks';

// "Sign with your account" (M9-E, docs/07). A homepage's guestbook widget sends a signed-in visitor here; core checks the
// return address really is that homepage's and issues a one-use pass, and this page sends the visitor straight back with it.
export function GuestbookSignPage() {
  const t = useT();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const to = params.get('to') ?? '';
  const back = params.get('return') ?? '';
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!to || !back) { setError(t('guestbookSign.missing')); return; }
    api.post<{ redirect: string }>(`/homes/${encodeURIComponent(to)}/guestbook-ticket`, { return_to: back })
      .then((r) => window.location.replace(r.redirect))
      .catch((e) => setError(errorText(e)));
  }, [to, back, t]);
  return (
    <main id="main" className="page">
      <h1>{t('guestbookSign.title')}</h1>
      {error ? <Alert kind="error">{error}</Alert> : <p role="status">{t('guestbookSign.going', { handle: to })}</p>}
    </main>
  );
}
