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
  const markOne = useMutation({ mutationFn: (id: string) => api.post('/notifications/read', { ids: [id] }), onSuccess: () => void refresh() });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read', { all: true }), onSuccess: () => void refresh() });
  const items = q.data?.pages.flatMap((p) => p.notifications) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;

  return (
    <div className="app-content">
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => markAll.mutate()} disabled={markAll.isPending || unread === 0}>{t('notifications.markAll')}</button>
      </div>
      {q.isError && <Alert kind="error">{errorText(q.error)}</Alert>}
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
