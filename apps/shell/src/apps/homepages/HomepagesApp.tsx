import { useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, BackLink, EmptyState, NotFound, TextField } from '../../components/ui';
import { errorText, formatWhen, useMe, useT } from '../../hooks';
import { AppLink, matchRoute, useAppNav } from '../../nav';

interface Entry { handle: string; display_name: string | null; title: string; description: string; url: string; updated: string | null }
interface GbEntry { id: string; name: string; url: string | null; message: string; at: string; member: string | null }

const ROUTES = ['', 'guestbook/:handle'] as const;

export default function HomepagesApp() {
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  if (!route) return <div className="app-content"><NotFound /></div>;
  return <div className="app-content">{route.pattern === '' ? <Directory /> : <Guestbook handle={route.params.handle!} />}</div>;
}

function Directory() {
  const t = useT();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [error, setError] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['homepages', term, sort],
    placeholderData: keepPreviousData, // the last results stay while new ones load, so typing doesn't flash "Loading"
    queryFn: ({ pageParam }) => api.get<{ homepages: Entry[]; next: number | null }>(`/homepages?sort=${sort}&offset=${pageParam}${term ? `&q=${encodeURIComponent(term)}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const random = useMutation({
    mutationFn: () => api.get<{ url: string }>('/homepages/random'),
    onSuccess: (r) => { window.open(r.url, '_blank', 'noopener'); }, onError: (e) => setError(errorText(e)),
  });
  const items = list.data?.pages.flatMap((p) => p.homepages) ?? [];
  return (
    <>
      <form role="search" className="search-form" onSubmit={(e: FormEvent) => { e.preventDefault(); setTerm(q.trim()); }}>
        <TextField label={t('homepages.search')} value={q} onChange={setQ} type="search" />
        <div className="field">
          <label htmlFor="hp-sort">{t('homepages.sort')}</label>
          <select id="hp-sort" value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')}>
            <option value="recent">{t('homepages.sort.recent')}</option>
            <option value="name">{t('homepages.sort.name')}</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit">{t('boards.search.go')}</button>
        <button className="btn" type="button" onClick={() => random.mutate()}>{t('homepages.random')}</button>
      </form>
      {error && <Alert kind="error">{error}</Alert>}
      {list.isError && <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>}
      {list.isSuccess && items.length === 0 && <EmptyState>{t('homepages.none')}</EmptyState>}
      <ul className="rows">
        {items.map((h) => (
          <li key={h.handle}>
            <a href={h.url} target="_blank" rel="noopener noreferrer" aria-label={t('homepages.visit', { name: h.title || h.handle })}><strong>{h.title || t('homepages.untitled')}</strong></a>{' '}
            <span className="muted">{t('homepages.by', { name: h.display_name || h.handle })}</span>
            {h.description && <p>{h.description}</p>}
            <p className="hint">
              {h.updated ? t('homepages.updated', { when: formatWhen(h.updated) ?? '' }) : ''} · <AppLink to={`guestbook/${h.handle}`}>{t('homepages.guestbook')}</AppLink>
            </p>
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('homepages.more')}</button>}
    </>
  );
}

// The guestbook as a page on the site: signed-in people sign with their own name; anyone else can
// still sign as a guest, as they can from the widget on the page itself.
function Guestbook({ handle }: { handle: string }) {
  const t = useT();
  const me = useMe().data;
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['guestbook', handle],
    queryFn: ({ pageParam }) => api.get<{ entries: GbEntry[]; mode: string; next: string | null }>(`/widgets/${handle}/guestbook${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const sign = useMutation({
    mutationFn: () => (me
      ? api.post<{ status: string }>(`/homes/${handle}/guestbook`, { message, url })
      : api.post<{ status: string }>(`/widgets/${handle}/guestbook`, { name, message, url })),
    onSuccess: (r) => { setNote(t(r.status === 'pending' ? 'guestbook.pending' : 'guestbook.thanks')); setError(null); setMessage(''); void qc.invalidateQueries({ queryKey: ['guestbook', handle] }); },
    onError: (e) => { setNote(null); setError(errorText(e)); },
  });
  const report = useMutation({
    mutationFn: (id: string) => api.post('/reports', { guestbook_entry: id, category: 'abuse', note: '' }),
    onSuccess: (_r, id) => setReported(id), onError: (e) => setError(errorText(e)),
  });
  if (list.isError) return <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>;
  const entries = list.data?.pages.flatMap((p) => p.entries) ?? [];
  const mode = list.data?.pages[0]?.mode;
  return (
    <>
      <BackLink to="">{t('guestbook.back')}</BackLink>
      <h2>{t('guestbook.title', { name: handle })}</h2>
      {mode === 'off' ? <p>{t('guestbook.closed')}</p> : (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); setNote(null); sign.mutate(); }}>
          {me ? <p className="muted">{t('guestbook.signAs', { name: me.display_name || me.handle })}</p> : (
            <>
              <p className="muted">{t('guestbook.loginHint')}</p>
              <TextField label={t('guestbook.name')} value={name} onChange={setName} maxLength={40} required />
            </>
          )}
          <TextField label={t('guestbook.url')} value={url} onChange={setUrl} maxLength={200} />
          <TextField label={t('guestbook.message')} value={message} onChange={setMessage} maxLength={500} multiline required />
          {error && <Alert kind="error">{error}</Alert>}
          {note && <Alert kind="success">{note}</Alert>}
          <button className="btn btn-primary" type="submit" disabled={sign.isPending}>{t('guestbook.sign')}</button>
        </form>
      )}
      {list.isSuccess && entries.length === 0 && <EmptyState>{t('guestbook.none')}</EmptyState>}
      <ul className="rows">
        {entries.map((e) => (
          <li key={e.id}>
            <strong>{e.name}</strong> <span className="muted">{formatWhen(e.at)}</span>
            <p className="post-body">{e.message}</p>
            {e.url && <p className="hint"><a href={e.url} target="_blank" rel="nofollow ugc noopener noreferrer">{e.url}</a></p>}
            {me && (reported === e.id
              ? <span className="muted" role="status">{t('guestbook.reported')}</span>
              : <button type="button" className="link" onClick={() => report.mutate(e.id)}>{t('guestbook.report')}</button>)}
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button className="btn" onClick={() => void list.fetchNextPage()}>{t('homepages.more')}</button>}
    </>
  );
}
