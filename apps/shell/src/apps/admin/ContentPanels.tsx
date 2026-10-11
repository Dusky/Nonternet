import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, EmptyState, Loading, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { ReasonForm } from '../boards/ModTools';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { useDebounced } from './useDebounced';

// ---------------------------------------------------------------- boards

interface AdminBoard { id: string; slug: string; name: string; owner: string; visibility: string; archived: boolean; ring: boolean; thread_count: number; last_post_at: string | null }

// Every board, private ones too, with search, paging, and the two things an admin does here: archive one, or give it
// to someone else. Both are audited.
export function BoardsTable() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [acting, setActing] = useState<{ board: AdminBoard; what: 'archive' | 'owner' } | null>(null);
  const [heir, setHeir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'boards', dq],
    queryFn: ({ pageParam }) => api.get<{ boards: AdminBoard[]; next: string | null }>(`/admin/boards?${new URLSearchParams({ ...(dq ? { q: dq } : {}), ...(pageParam ? { before: pageParam } : {}) })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const done = () => { setActing(null); setHeir(''); setError(null); void qc.invalidateQueries({ queryKey: ['admin', 'boards'] }); void qc.invalidateQueries({ queryKey: ['boards'] }); };
  const archive = useMutation({
    mutationFn: (b: AdminBoard) => api.patch(`/boards/${b.slug}`, { archived: !b.archived }),
    onSuccess: done, onError: (e) => setError(errorText(e)),
  });
  const give = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/boards/${acting!.board.id}/owner`, { handle: heir.trim(), reason }),
    onSuccess: done, onError: (e) => setError(errorText(e)),
  });
  if (list.isError) return <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>;
  const boards = list.data?.pages.flatMap((p) => p.boards) ?? [];
  return (
    <>
      <h2>{t('admin.tab.boards')}</h2>
      <TextField label={t('admin.boards.search')} value={q} onChange={setQ} type="search" autoCapitalize="none" spellCheck={false} />
      {list.isPending && <Loading />}
      {list.isSuccess && boards.length === 0 && <EmptyState>{t('admin.boards.none')}</EmptyState>}
      {error && !acting && <Alert kind="error">{error}</Alert>}
      {boards.length > 0 && (
        <table className="table">
          <thead><tr>
            <th scope="col">{t('admin.boards.col.name')}</th><th scope="col">{t('admin.boards.col.owner')}</th><th scope="col">{t('admin.boards.col.visibility')}</th>
            <th scope="col">{t('admin.boards.col.threads')}</th><th scope="col">{t('admin.boards.col.last')}</th><th scope="col">{t('admin.boards.col.actions')}</th>
          </tr></thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.id}>
                <th scope="row" data-label={t('admin.boards.col.name')}>
                  <OpenAppLink app="boards" to={b.slug}>{b.name}</OpenAppLink>{b.archived && <> <span className="badge">{t('boards.badge.archived')}</span></>}
                </th>
                <td data-label={t('admin.boards.col.owner')}>{b.owner}</td>
                <td data-label={t('admin.boards.col.visibility')}>{b.ring ? t('admin.boards.ringBoard') : t(`boards.vis.short.${b.visibility === 'ring' ? 'public' : b.visibility}` as never)}</td>
                <td data-label={t('admin.boards.col.threads')}>{b.thread_count}</td>
                <td data-label={t('admin.boards.col.last')}>{formatWhen(b.last_post_at) ?? t('admin.never')}</td>
                <td data-label={t('admin.boards.col.actions')}>
                  {!b.ring && (
                    <>
                      <button type="button" className="link" disabled={archive.isPending} onClick={() => { setError(null); archive.mutate(b); }} aria-label={`${b.archived ? t('admin.boards.unarchive') : t('admin.boards.archive')}: ${b.name}`}>
                        {b.archived ? t('admin.boards.unarchive') : t('admin.boards.archive')}
                      </button>{' · '}
                      <button type="button" className="link" onClick={() => { setError(null); setActing({ board: b, what: 'owner' }); }} aria-label={`${t('admin.boards.giveTo')}: ${b.name}`}>{t('admin.boards.giveTo')}</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasNextPage && <button type="button" className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('admin.more')}</button>}
      {acting?.what === 'owner' && (
        <ReasonForm label={t('admin.boards.giveThis', { name: acting.board.name })} submitLabel={t('admin.boards.giveTo')} pending={give.isPending} error={error}
          onSubmit={(reason) => give.mutate(reason)} onCancel={() => setActing(null)}>
          <TextField label={t('admin.boards.newOwner')} value={heir} onChange={setHeir} autoCapitalize="none" spellCheck={false} required />
        </ReasonForm>
      )}
    </>
  );
}

// ---------------------------------------------------------------- homepages

interface HpRow { user_id: string; handle: string; title: string; size_bytes: number; file_count: number; has_index: boolean; last_updated_at: string | null; hidden: boolean; url: string }
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function HomepagesTable() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [acting, setActing] = useState<HpRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'homepages', dq],
    queryFn: ({ pageParam }) => api.get<{ homepages: HpRow[]; totals: { homepages: string; bytes: string; hidden: string }; next: string | null }>(`/admin/homepages?${new URLSearchParams({ ...(dq ? { q: dq } : {}), ...(pageParam ? { before: pageParam } : {}) })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const run = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/homepages/${acting!.user_id}/${acting!.hidden ? 'restore' : 'hide'}`, { reason }),
    onSuccess: () => { setActing(null); setError(null); void qc.invalidateQueries({ queryKey: ['admin'] }); }, onError: (e) => setError(errorText(e)),
  });
  if (list.isError) return <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>;
  const first = list.data?.pages[0];
  const d = first && { totals: first.totals, homepages: list.data!.pages.flatMap((p) => p.homepages) };
  return (
    <>
      <h2>{t('admin.tab.homepages')}</h2>
      <TextField label={t('admin.homepages.search')} value={q} onChange={setQ} type="search" autoCapitalize="none" spellCheck={false} />
      {d && <p className="hint">{t('admin.homepages.totals', { count: d.totals.homepages, size: mb(Number(d.totals.bytes)), hidden: d.totals.hidden })}</p>}
      {d && d.homepages.length === 0 && <EmptyState>{t('admin.homepages.none')}</EmptyState>}
      {d && d.homepages.length > 0 && (
        <table className="table">
          <thead><tr>
            <th scope="col">{t('admin.homepages.col.owner')}</th><th scope="col">{t('admin.homepages.col.title')}</th><th scope="col">{t('admin.homepages.col.size')}</th>
            <th scope="col">{t('admin.homepages.col.updated')}</th><th scope="col">{t('admin.homepages.col.state')}</th>
          </tr></thead>
          <tbody>
            {d.homepages.map((h) => (
              <tr key={h.user_id}>
                <th scope="row" data-label={t('admin.homepages.col.owner')}><a href={h.url} target="_blank" rel="noopener noreferrer">{h.handle}</a></th>
                <td data-label={t('admin.homepages.col.title')}>{h.title}</td>
                <td data-label={t('admin.homepages.col.size')}>{mb(h.size_bytes)}</td>
                <td data-label={t('admin.homepages.col.updated')}>{formatWhen(h.last_updated_at) ?? t('admin.never')}</td>
                <td data-label={t('admin.homepages.col.state')}>
                  {h.hidden && <span className="badge badge-warn">{t('admin.homepages.hidden')}</span>}{' '}
                  <button type="button" className="link" onClick={() => { setError(null); setActing(h); }} aria-label={t('admin.homepages.hideThis', { name: h.handle })}>
                    {h.hidden ? t('admin.homepages.restore') : t('admin.homepages.hide')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasNextPage && <button type="button" className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('admin.more')}</button>}
      {acting && (
        <ReasonForm label={t('admin.homepages.hideThis', { name: acting.handle })} submitLabel={t('boards.mod.confirm')} pending={run.isPending} error={error}
          onSubmit={(reason) => run.mutate(reason)} onCancel={() => setActing(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- rings

interface RingRow { id: string; slug: string; name: string; founder: string; members: number; archived: boolean; hidden: boolean; board: string | null }

export function RingsTable() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [acting, setActing] = useState<RingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'rings', dq],
    queryFn: ({ pageParam }) => api.get<{ rings: RingRow[]; next: string | null }>(`/admin/rings?${new URLSearchParams({ ...(dq ? { q: dq } : {}), ...(pageParam ? { before: pageParam } : {}) })}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const run = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/rings/${acting!.id}/${acting!.hidden ? 'restore' : 'hide'}`, { reason }),
    onSuccess: () => { setActing(null); setError(null); void qc.invalidateQueries({ queryKey: ['admin'] }); }, onError: (e) => setError(errorText(e)),
  });
  if (list.isError) return <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>;
  const rings = list.data?.pages.flatMap((p) => p.rings) ?? [];
  return (
    <>
      <h2>{t('admin.tab.rings')}</h2>
      <TextField label={t('admin.rings.search')} value={q} onChange={setQ} type="search" autoCapitalize="none" spellCheck={false} />
      {list.data && rings.length === 0 && <EmptyState>{t('admin.rings.none')}</EmptyState>}
      {rings.length > 0 && (
        <table className="table">
          <thead><tr>
            <th scope="col">{t('admin.rings.col.name')}</th><th scope="col">{t('admin.rings.col.founder')}</th><th scope="col">{t('admin.rings.col.members')}</th><th scope="col">{t('admin.rings.col.state')}</th>
          </tr></thead>
          <tbody>
            {rings.map((r) => (
              <tr key={r.id}>
                <th scope="row" data-label={t('admin.rings.col.name')}><OpenAppLink app="rings" to={r.slug}>{r.name}</OpenAppLink></th>
                <td data-label={t('admin.rings.col.founder')}>{r.founder}</td>
                <td data-label={t('admin.rings.col.members')}>{r.members}</td>
                <td data-label={t('admin.rings.col.state')}>
                  {r.archived && <span className="badge">{t('boards.badge.archived')}</span>} {r.hidden && <span className="badge badge-warn">{t('admin.homepages.hidden')}</span>}{' '}
                  <button type="button" className="link" onClick={() => { setError(null); setActing(r); }} aria-label={t(r.hidden ? 'admin.rings.restoreThis' : 'admin.rings.hideThis', { name: r.name })}>
                    {t(r.hidden ? 'admin.rings.restore' : 'admin.rings.hide')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.hasNextPage && <button type="button" className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('admin.more')}</button>}
      {acting && <ReasonForm label={t(acting.hidden ? 'admin.rings.restoreThis' : 'admin.rings.hideThis', { name: acting.name })} submitLabel={t('boards.mod.confirm')} pending={run.isPending} error={error} onSubmit={(reason) => run.mutate(reason)} onCancel={() => setActing(null)} />}
    </>
  );
}

