import { Fragment, type ReactNode } from 'react';
import { imageUrl, parseWiki, type Inline } from '@app/shared';
import { PersonLink } from '../apps/people/PersonLink';

// A post's or a message's text as the reader sees it (docs/23). The same safe parser as the wiki gives data, never
// HTML: emphasis, lists, quotes (including the boards' "AB> " quotes), code and links. Line breaks are kept, because
// people write posts line by line. @handles link to the person. What is stored doesn't change, so the BBS and the
// mirrors keep showing the plain text.

// The same rule as core's extractMentions (apps/core/src/text.ts): not inside an address or a word.
const MENTION = /(?<![A-Za-z0-9_@./-])@([A-Za-z][A-Za-z0-9_-]{1,19})\b/g;

function withMentions(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<PersonLink key={`${key}-${m.index}`} app="people" to={m[1]!}>@{m[1]}</PersonLink>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inline(segs: Inline[], key: string): ReactNode {
  return segs.map((s, i) => {
    const k = `${key}.${i}`;
    switch (s.kind) {
      case 'text': return <Fragment key={k}>{withMentions(s.text, k)}</Fragment>;
      case 'em': return <em key={k}>{s.text}</em>;
      case 'strong': return <strong key={k}>{s.text}</strong>;
      case 'code': return <code key={k}>{s.text}</code>;
      case 'image': return <img key={k} className="post-image" src={imageUrl(s.id)} alt={s.text} loading="lazy" decoding="async" />;
      case 'link': return <a key={k} href={s.href} target="_blank" rel="noopener noreferrer">{s.text}</a>;
      // Wiki links only work on wiki pages; elsewhere they stay as typed.
      case 'wiki': return <Fragment key={k}>{`[[${s.target}${s.text !== s.target ? `|${s.text}` : ''}]]`}</Fragment>;
    }
  });
}

export function RichText({ body, className }: { body: string; className?: string }) {
  return (
    <div className={`rich-text${className ? ` ${className}` : ''}`}>
      {parseWiki(body, { lineBreaks: true, fidoQuotes: true }).map((b, i) => {
        const k = String(i);
        switch (b.kind) {
          // Posts have no headings of their own: a "# line" reads as a bold line.
          case 'heading': return <p key={k}><strong>{inline(b.content, k)}</strong></p>;
          case 'paragraph': return <p key={k}>{inline(b.content, k)}</p>;
          case 'list': { const L = b.ordered ? 'ol' : 'ul'; return <L key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}.${j}`)}</li>)}</L>; }
          case 'quote': return <blockquote key={k}>{b.content.map((l, j) => <p key={j}>{inline(l, `${k}.${j}`)}</p>)}</blockquote>;
          case 'code': return <pre key={k}><code>{b.text}</code></pre>;
        }
      })}
    </div>
  );
}
