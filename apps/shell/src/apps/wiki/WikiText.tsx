import { Fragment, type ReactNode } from 'react';
import { parseWiki, type Inline } from '@app/shared';
import { useT } from '../../hooks';
import { AppLink } from '../../nav';

// A wiki page's text as the reader sees it (docs/20). The shared parser gives data; this turns it into elements, so
// nothing anyone wrote can become HTML. A link to a page that doesn't exist yet says so in words as well as colour.
export function WikiText({ body, base, exists }: { body: string; base: string; exists: (slug: string) => boolean }) {
  const t = useT();
  const inline = (segs: Inline[]): ReactNode => segs.map((s, i) => {
    switch (s.kind) {
      case 'text': return <Fragment key={i}>{s.text}</Fragment>;
      case 'em': return <em key={i}>{s.text}</em>;
      case 'strong': return <strong key={i}>{s.text}</strong>;
      case 'code': return <code key={i}>{s.text}</code>;
      case 'image': return <Fragment key={i}>{`[picture: ${s.text || t('editor.picture.none')}]`}</Fragment>; // wiki pages have no pictures yet
      case 'link': return <a key={i} href={s.href} target="_blank" rel="noopener noreferrer">{s.text}</a>;
      case 'wiki': return exists(s.slug)
        ? <AppLink key={i} to={`${base}p/${s.slug}`}>{s.text}</AppLink>
        : <AppLink key={i} to={`${base}p/${s.slug}`} className="wiki-missing" title={t('wiki.missingTitle', { name: s.target })}>{s.text}<span className="visually-hidden"> {t('wiki.missing')}</span></AppLink>;
    }
  });
  return (
    <div className="wiki-text">
      {parseWiki(body).map((b, i) => {
        switch (b.kind) {
          case 'heading': { const H = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5'; return <H key={i}>{inline(b.content)}</H>; }
          case 'paragraph': return <p key={i}>{inline(b.content)}</p>;
          case 'list': { const L = b.ordered ? 'ol' : 'ul'; return <L key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</L>; }
          case 'quote': return <blockquote key={i}>{b.content.map((l, j) => <p key={j}>{inline(l)}</p>)}</blockquote>;
          case 'code': return <pre key={i}><code>{b.text}</code></pre>;
        }
      })}
    </div>
  );
}
