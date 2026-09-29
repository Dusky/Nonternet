import { useEffect, useMemo, useState } from 'react';
import type { PublicSite } from '@app/shared';
import { en, makeT } from '@app/strings';
import { fetchSite } from './site';

export function App() {
  const [site, setSite] = useState<PublicSite | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchSite().then(setSite, () => setFailed(true));
  }, []);

  const t = useMemo(() => (site ? makeT(site) : null), [site]);

  useEffect(() => {
    if (t) document.title = t('landing.title');
  }, [t]);

  if (failed) return <p role="alert">{en['error.generic']}</p>;
  if (!t) return null;

  return (
    <main>
      <h1>{t('landing.title')}</h1>
      <p>{t('landing.tagline')}</p>
    </main>
  );
}
