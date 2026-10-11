import { Fragment, type ReactNode } from 'react';
import { parseWiki, wikiSlug, type Inline } from '@app/shared';
import { useT } from '../../hooks';
import { AppLink } from '../../nav';

// A wiki page's text as the reader sees it (docs/20). The shared parser gives data; this turns it into elements, so
// nothing anyone wrote can become HTML. A link to a page that doesn't exist yet says so in words as well as colour.
const plain = (segs: Inline[]) => segs.map((s) => s.text).join('');

// `toc`: a list of the headings at the top, each a link to its place, when there are three or more.
export function WikiText({ body, base, exists, toc }: { body: string; base: string; exists: (slug: string) => boolean; toc?: boolean }) {
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
  const blocks = parseWiki(body);
  // Each heading gets an id from its words ("h-getting-started"), numbered when two read the same.
  const used = new Map<string, number>();
  const ids = blocks.map((b) => {
    if (b.kind !== 'heading') return '';
    const base = `h-${wikiSlug(plain(b.content)) || 'section'}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
  const headings = blocks.flatMap((b, i) => (b.kind === 'heading' ? [{ id: ids[i]!, level: b.level, text: plain(b.content) }] : []));
  const jump = (id: string) => { const el = document.getElementById(id); el?.scrollIntoView({ block: 'start' }); el?.focus({ preventScroll: true }); };
  return (
    <div className="wiki-text">
      {toc && headings.length >= 3 && (
        <nav className="wiki-toc" aria-labelledby="wiki-toc-h">
          <h3 id="wiki-toc-h">{t('wiki.contents')}</h3>
          <ol>
            {headings.map((h) => (
              <li key={h.id} className={`toc-${h.level}`}>
                <a href={`#${h.id}`} onClick={(e) => { e.preventDefault(); jump(h.id); }}>{h.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading': { const H = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5'; return <H key={i} id={toc ? ids[i] : undefined} tabIndex={toc ? -1 : undefined}>{inline(b.content)}</H>; }
          case 'paragraph': return <p key={i}>{inline(b.content)}</p>;
          case 'list': { const L = b.ordered ? 'ol' : 'ul'; return <L key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</L>; }
          case 'quote': return <blockquote key={i}>{b.content.map((l, j) => <p key={j}>{inline(l)}</p>)}</blockquote>;
          case 'code': return <pre key={i}><code>{b.text}</code></pre>;
        }
      })}
    </div>
  );
}
