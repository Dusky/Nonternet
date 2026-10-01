import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ModLogEntry } from '@app/shared';
import { api } from '../../api';
import { Alert, BackLink, EmptyState } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

export function ModLog({ slug, canUndo }: { slug: string; canUndo: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['modlog', slug],
    queryFn: ({ pageParam }) => api.get<{ entries: ModLogEntry[]; next: string | null }>(`/modlog?board=${slug}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.post(`/mod-actions/${id}/undo`, {}),
    onSuccess: () => { for (const k of ['modlog', 'thread', 'threads', 'boards']) void qc.invalidateQueries({ queryKey: [k] }); },
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <>
      <BackLink to={slug}>{slug}</BackLink>
      <h2>{t('boards.modlog')}</h2>
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {undo.isError && <Alert kind="error">{errorText(undo.error)}</Alert>}
      {q.isSuccess && entries.length === 0 && <EmptyState>{t('boards.modlog.none')}</EmptyState>}
      <ul className="rows">
        {entries.map((e) => (
          <li key={e.id}>
            <strong>{t('boards.modlog.entry', { actor: e.actor.handle, action: t(`boards.modlog.action.${e.action}`) })}</strong>{' '}
            {e.undone && <span className="badge">{t('boards.modlog.undone')}</span>}
            <p className="hint">
              {formatWhen(e.at)}
              {e.post_author ? ` · ${t('boards.modlog.author', { name: e.post_author })}` : ''}
              {e.action === 'move' && e.detail ? ` · ${t('boards.modlog.moved', { from: String(e.detail.from), to: String(e.detail.to) })}` : ''}
            </p>
            <p>{t('boards.modlog.why', { reason: e.reason })}</p>
            {canUndo && e.undoable && <button type="button" className="link" onClick={() => undo.mutate(e.id)} disabled={undo.isPending}>{t('boards.modlog.undo')}</button>}
          </li>
        ))}
      </ul>
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('boards.more')}</button>}
    </>
  );
}
