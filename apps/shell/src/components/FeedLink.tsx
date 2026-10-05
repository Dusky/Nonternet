import { useEffect } from 'react';
import { useT } from '../hooks';

// An Atom feed of what's on this screen (docs/05): a plain link people can copy into a feed reader, and the
// <link rel="alternate"> readers and browser add-ons look for in the page, there only while the screen is open.
export function FeedLink({ href, title }: { href: string; title: string }) {
  const t = useT();
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.type = 'application/atom+xml';
    link.title = title;
    link.href = href;
    document.head.appendChild(link);
    return () => link.remove();
  }, [href, title]);
  return <a className="btn btn-quiet" href={href} type="application/atom+xml" title={t('feed.title')}>{t('feed.link')}</a>;
}
