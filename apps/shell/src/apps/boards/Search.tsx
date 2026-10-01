import { Fragment, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { BoardSummary, PostView } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField, BackLink, EmptyState, RelativeTime } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { AppLink, useAppNav } from '../../nav';

interface Hit { post: PostView; board: { slug: string; name: string }; snippet: string }

// The server marks matches with U+0002 and U+0003, which post text cannot contain, so the snippet
// is split on them and drawn as text. It is never treated as HTML.
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/\u0002|\u0003/);
  return <>{parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>))}</>;
}

export function Search({ board: fixedBoard, initial = '' }: { board?: string; initial?: string }) {
  const t = useT();
  const nav = useAppNav();
  const me = useMe().data;
  const [input, setInput] = useState(initial);
  const [term, setTerm] = useState(initial);
  const [pick, setPick] = useState('');
  const board = fixedBoard ?? (pick || undefined);
  const boards = useQuery({ queryKey: ['boards', me?.id ?? null], enabled: !fixedBoard, staleTime: 60_000, queryFn: () => api.get<{ boards: BoardSummary[] }>('/boards') }).data?.boards ?? [];
  const q = useInfiniteQuery({
    queryKey: ['search', term, board ?? null],
    enabled: term.length >= 2,
    queryFn: ({ pageParam }) => api.get<{ hits: Hit[]; next: number | null }>(
      `/search?q=${encodeURIComponent(term)}${board ? `&board=${board}` : ''}${pageParam ? `&offset=${pageParam}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const hits = q.data?.pages.flatMap((p) => p.hits) ?? [];
  // The search lives in the address (search/<words>), so Back returns to it and the link can be shared.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = input.trim();
    setTerm(v);
    if (!fixedBoard && v.length >= 2) nav.go(`search/${encodeURIComponent(v)}`, { replace: initial !== '' });
  };
  return (
    <>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <h2>{t('boards.search.title')}</h2>
      <form onSubmit={submit} role="search" className="search-form">
        <TextField label={t('boards.search.label')} value={input} onChange={setInput} type="search" minLength={2} required />
        {!fixedBoard && boards.length > 0 && (
          <div className="field">
            <label htmlFor="search-board">{t('boards.search.inBoard')}</label>
            <select id="search-board" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('boards.search.allBoards')}</option>
              {boards.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
            </select>
          </div>
        )}
        <button className="btn btn-primary" type="submit">{t('boards.search.go')}</button>
      </form>
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.isSuccess && hits.length === 0 && <EmptyState>{t('boards.search.none')}</EmptyState>}
      <ul className="rows">
        {hits.map((h) => (
          <li key={h.post.id}>
            <AppLink to={`${h.board.slug}/t/${h.post.thread_id}`}><strong>{h.post.subject}</strong></AppLink>{' '}
            <span className="muted">{t('boards.search.in', { board: h.board.name })}{h.post.author ? ` · ${t('boards.by', { name: h.post.author.handle })}` : ''} · <RelativeTime iso={h.post.posted_at} /></span>
            <p className="snippet"><Snippet text={h.snippet.replace(/\n/g, ' ')} /></p>
          </li>
        ))}
      </ul>
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('boards.more')}</button>}
    </>
  );
}
