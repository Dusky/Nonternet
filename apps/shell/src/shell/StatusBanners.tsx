import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { onSessionExpired } from '../api';
import { useT } from '../hooks';

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
};

// Two things worth saying at the top of every screen: the browser is offline, and the session has ended.
// Neither throws away what someone was writing: the second is a link back to log in, not a redirect.
export function StatusBanners() {
  const t = useT();
  const location = useLocation();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [expired, setExpired] = useState(false);
  const qc = useQueryClient();
  useEffect(() => onSessionExpired(() => setExpired(true)), []);
  // Back from logging in (in the other tab): the banner goes and everything is fetched again.
  useEffect(() => {
    if (!expired) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch('/api/v1/me', { credentials: 'same-origin' }).then((r) => { if (r.ok) { setExpired(false); void qc.invalidateQueries(); } }).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [expired, qc]);
  const back = encodeURIComponent(location.pathname + location.search);
  return (
    <>
      {!online && <div className="banner banner-warn" role="status">{t('status.offline')}</div>}
      {expired && (
        <div className="banner banner-error" role="alert">
          <span>{t('status.expired')}</span> <a className="btn btn-small" href={`/login?return_to=${back}`} target="_blank" rel="noopener">{t('status.expiredLogin')}</a>
        </div>
      )}
    </>
  );
}
