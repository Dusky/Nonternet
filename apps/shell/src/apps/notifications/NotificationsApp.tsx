import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationView } from '@app/shared';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
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
      {q.isSuccess && items.length === 0 && <p>{t('notifications.none')}</p>}
      <ul className="rows notif-rows">
        {items.map((n) => {
          const name = n.actor.display_name || n.actor.handle;
          return (
            <li key={n.id} className={n.read ? undefined : 'is-unread'}>
              <OpenAppLink app="boards" to={`${n.board.slug}/t/${n.thread_id}`} onClick={() => { if (!n.read) markOne.mutate(n.id); }}>
                <strong>{t(`notifications.${n.kind}`, { name })}</strong>
              </OpenAppLink>{' '}
              {!n.read && <span className="badge badge-open">{t('notifications.unreadBadge')}</span>}
              <p className="hint">{n.subject && <>{n.subject} · </>}{t('notifications.in', { board: n.board.name })} · {formatWhen(n.at)}</p>
            </li>
          );
        })}
      </ul>
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('notifications.more')}</button>}
    </div>
  );
}
