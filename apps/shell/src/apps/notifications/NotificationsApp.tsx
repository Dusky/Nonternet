import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationView } from '@app/shared';
import { api } from '../../api';
import { Alert, Avatar, EmptyState, Loading, RelativeTime } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';

interface Page { notifications: NotificationView[]; unread: number; next: string | null }

export default function NotificationsApp() {
  const t = useT();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    queryFn: ({ pageParam }) => api.get<Page>(`/notifications${pageParam ? `?before=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  // Read marks show at once (the list and the bell); the server catches up, and a refusal puts them back.
  const listKey = ['notifications', 'list'];
  const markLocally = async (which: (n: NotificationView) => boolean) => {
    await qc.cancelQueries({ queryKey: listKey });
    const before = qc.getQueryData(listKey);
    qc.setQueryData<{ pages: Page[]; pageParams: unknown[] }>(listKey, (d) => d && {
      ...d,
      pages: d.pages.map((p, i) => {
        const notifications = p.notifications.map((n) => (which(n) ? { ...n, read: true } : n));
        const cleared = p.notifications.filter((n) => which(n) && !n.read).length;
        return { ...p, notifications, unread: i === 0 ? Math.max(0, p.unread - (which === all ? p.unread : cleared)) : p.unread };
      }),
    });
    return { before };
  };
  const all = () => true;
  const markOne = useMutation({
    mutationFn: (id: string) => api.post('/notifications/read', { ids: [id] }),
    onMutate: (id) => markLocally((n) => n.id === id),
    onError: (_e, _id, c) => qc.setQueryData(listKey, c?.before),
    onSettled: () => void refresh(),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read', { all: true }),
    onMutate: () => markLocally(all),
    onError: (_e, _v, c) => qc.setQueryData(listKey, c?.before),
    onSettled: () => void refresh(),
  });
  const items = q.data?.pages.flatMap((p) => p.notifications) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;

  return (
    <div className="app-content">
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => markAll.mutate()} disabled={unread === 0}>{t('notifications.markAll')}</button>
      </div>
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.isSuccess && items.length === 0 && <EmptyState>{t('notifications.none')}</EmptyState>}
      {q.isPending && <Loading rows={3} />}
      <ul className="rows notif-rows">
        {items.map((n) => {
          const name = n.actor.display_name || n.actor.handle;
          return (
            <li key={n.id} className={`mail-row${n.read ? '' : ' is-unread'}`}>
              <Avatar id={n.actor.id} name={name} />
              <div>
                <div className="row-head">
                  <span>
                    <OpenAppLink app="boards" to={`${n.board.slug}/t/${n.thread_id}`} onClick={() => { if (!n.read) markOne.mutate(n.id); }}>
                      <strong>{t(`notifications.${n.kind}`, { name })}</strong>
                    </OpenAppLink>{' '}
                    {!n.read && <span className="badge badge-accent">{t('notifications.unreadBadge')}</span>}
                  </span>
                  <span className="row-meta"><RelativeTime iso={n.at} /></span>
                </div>
                <p className="row-meta">{n.subject && <>{n.subject} · </>}{t('notifications.in', { board: n.board.name })}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('notifications.more')}</button>}
    </div>
  );
}
