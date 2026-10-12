import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { NOTIFICATION_FILTERS, NOTIFICATION_FILTER_KINDS, type NotificationFilter, type NotificationView } from '@app/shared';
import { api } from '../../api';
import { Alert, Avatar, EmptyState, Loading, RelativeTime } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { dayLabel } from '../chat/helpers';
import { groupNotifications, type NotificationGroup } from './group';

interface Page { notifications: NotificationView[]; unread: number; next: string | null }
type Data = { pages: Page[]; pageParams: unknown[] };

export default function NotificationsApp() {
  const t = useT();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const listKey = ['notifications', 'list', filter];
  const q = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) => api.get<Page>(`/notifications?filter=${filter}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  // Read marks show at once (the list and the bell); the server catches up, and a refusal puts them back.
  const markLocally = async (which: (n: NotificationView) => boolean, read: boolean) => {
    await qc.cancelQueries({ queryKey: listKey });
    const before = qc.getQueryData<Data>(listKey);
    qc.setQueryData<Data>(listKey, (d) => d && {
      ...d,
      pages: d.pages.map((p, i) => {
        const changed = p.notifications.filter((n) => which(n) && n.read === read).length;
        return {
          ...p,
          notifications: p.notifications.map((n) => (which(n) ? { ...n, read: !read } : n)),
          unread: i === 0 ? Math.max(0, p.unread + (read ? changed : -changed)) : p.unread,
        };
      }),
    });
    return { before };
  };
  const setRead = useMutation({
    mutationFn: ({ ids, read }: { ids: string[]; read: boolean }) => api.post(read ? '/notifications/read' : '/notifications/unread', { ids }),
    onMutate: ({ ids, read }) => markLocally((n) => ids.includes(n.id), !read),
    onError: (_e, _v, c) => qc.setQueryData(listKey, c?.before),
    onSettled: () => void refresh(),
  });
  const markAll = useMutation({
    // On a tab (Boards, Mail, ...) only that tab's kinds are marked; "All" and "Unread" mark everything.
    mutationFn: () => api.post('/notifications/read', filter === 'all' || filter === 'unread' ? { all: true } : { kinds: NOTIFICATION_FILTER_KINDS[filter] }),
    onMutate: () => markLocally(() => true, false),
    onError: (_e, _v, c) => qc.setQueryData(listKey, c?.before),
    onSettled: () => void refresh(),
  });
  const items = q.data?.pages.flatMap((p) => p.notifications) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;
  // Enabled by what this tab shows, not by the number on the bell.
  const anyUnread = filter === 'all' ? unread > 0 : items.some((n) => !n.read);
  const days = groupNotifications(items);
  const now = Date.now();
  const words = { today: t('chat.today'), yesterday: t('chat.yesterday') };

  return (
    <div className="app-content">
      <div className="toolbar">
        <div className="choice-row" role="group" aria-label={t('notifications.show')}>
          {NOTIFICATION_FILTERS.map((f) => (
            <button key={f} type="button" className={`btn btn-quiet btn-small${filter === f ? ' is-active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`notifications.filter.${f}`)}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => markAll.mutate()} disabled={!anyUnread}>{t('notifications.markAll')}</button>
      </div>
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {setRead.isError && <Alert kind="error">{errorText(setRead.error)}</Alert>}
      {q.isSuccess && items.length === 0 && <EmptyState>{filter === 'all' ? t('notifications.none') : t('notifications.noneHere')}</EmptyState>}
      {q.isPending && <Loading rows={3} />}
      {days.map((d) => (
        <section key={d.day} aria-label={dayLabel(Date.parse(d.at), now, words)}>
          <h3 className="notif-day">{dayLabel(Date.parse(d.at), now, words)}</h3>
          <ul className="rows notif-rows">
            {d.groups.map((g) => <Row key={g.first.id} g={g} onRead={(read) => setRead.mutate({ ids: g.items.map((n) => n.id), read })} />)}
          </ul>
        </section>
      ))}
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('notifications.more')}</button>}
    </div>
  );
}

function Row({ g, onRead }: { g: NotificationGroup; onRead: (read: boolean) => void }) {
  const t = useT();
  const n = g.first;
  const name = n.actor.display_name || n.actor.handle;
  // A repeated thing is one line with a count: "Ada and 2 more reacted", "new mail (3)", "Ada and 1 other replied".
  const text = g.others > 0 ? t('notifications.replyMany', { name, others: g.others, count: g.others })
    : g.items.length > 1 ? t('notifications.replyAgain', { name, count: g.items.length })
    : n.count > 1 && n.kind === 'memo_reaction' ? t('notifications.memoReactionMany', { name, others: n.count - 1 })
    : n.count > 1 && n.kind === 'memo_reply' ? t('notifications.memoReplyMany', { name, others: n.count - 1 })
    : n.count > 1 && n.kind === 'reaction' ? t('notifications.reactionMany', { name, others: n.count - 1 })
    : n.count > 1 && n.kind === 'mail' ? t('notifications.mailMany', { name, count: n.count })
    : t(`notifications.${n.kind}`, { name });
  return (
    <li className={`mail-row notif-row${n.read ? '' : ' is-unread'}`}>
      <Avatar id={n.actor.id} name={name} />
      <div>
        <div className="row-head">
          <span>
            <OpenAppLink app={n.link.app} to={n.link.to} className="notif-link" onClick={() => { if (!n.read) onRead(true); }}>
              <strong>{text}</strong>
            </OpenAppLink>{' '}
            {!n.read && <span className="badge badge-accent">{t('notifications.unreadBadge')}</span>}
          </span>
          <span className="row-meta"><RelativeTime iso={n.at} /></span>
        </div>
        <p className="row-meta">{[n.subject, n.place && t('notifications.in', { board: n.place })].filter(Boolean).join(' · ')}</p>
        <p className="row-actions">
          <button type="button" className="link" onClick={() => onRead(!n.read)} aria-label={`${n.read ? t('notifications.markUnread') : t('notifications.markRead')}: ${text}`}>
            {n.read ? t('notifications.markUnread') : t('notifications.markRead')}
          </button>
        </p>
      </div>
    </li>
  );
}
