import { Fragment, useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { PostView } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField, BackLink, EmptyState } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { AppLink } from '../../nav';

interface Hit { post: PostView; board: { slug: string; name: string }; snippet: string }

// The server marks matches with U+0002 and U+0003, which post text cannot contain, so the snippet
// is split on them and drawn as text. It is never treated as HTML.
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/\u0002|\u0003/);
  return <>{parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}</>;
}

export function Search({ board }: { board?: string }) {
  const t = useT();
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['search', term, board ?? null],
    enabled: term.length >= 2,
    queryFn: ({ pageParam }) => api.get<{ hits: Hit[]; next: number | null }>(
      `/search?q=${encodeURIComponent(term)}${board ? `&board=${board}` : ''}${pageParam ? `&offset=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const hits = q.data?.pages.flatMap((p) => p.hits) ?? [];
  const submit = (e: FormEvent) => { e.preventDefault(); setTerm(input.trim()); };
  return (
    <>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <h2>{t('boards.search.title')}</h2>
      <form onSubmit={submit} role="search" className="search-form">
        <TextField label={t('boards.search.label')} value={input} onChange={setInput} type="search" minLength={2} required />
        <button className="btn btn-primary" type="submit">{t('boards.search.go')}</button>
      </form>
      {q.isError && <Alert kind="error">{errorText(q.error)}</Alert>}
      {q.isSuccess && hits.length === 0 && <EmptyState>{t('boards.search.none')}</EmptyState>}
      <ul className="rows">
        {hits.map((h) => (
          <li key={h.post.id}>
            <AppLink to={`${h.board.slug}/t/${h.post.thread_id}`}><strong>{h.post.subject}</strong></AppLink>{' '}
            <span className="muted">{t('boards.search.in', { board: h.board.name })}{h.post.author ? ` · ${t('boards.by', { name: h.post.author.handle })}` : ''} · {formatWhen(h.post.posted_at)}</span>
            <p className="snippet"><Snippet text={h.snippet.replace(/\n/g, ' ')} /></p>
          </li>
        ))}
      </ul>
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('boards.more')}</button>}
    </>
  );
}
