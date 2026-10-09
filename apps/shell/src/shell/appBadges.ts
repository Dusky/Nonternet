import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { NotificationCounts } from '@app/shared';
import { api } from '../api';
import type { AppId } from './windows';

// The numbers on app icons (docs/10): mail with something new, things aimed at you in Boards, ring news, chat
// mentions and messages, and open reports for admins. Shell works them out from the counts it already fetches and
// keeps them here, so the desktop, the Apps menu, the taskbar and the phone grid all read the same numbers.
export interface AppBadge { count: number; strong: boolean }
export type AppBadges = Partial<Record<AppId, AppBadge>>;

export const BADGE_CAP = 99;
export const badgeText = (n: number): string => (n > BADGE_CAP ? `${BADGE_CAP}+` : String(n));

export function badgeMap(i: { mail: number; counts?: NotificationCounts; chat: number }): AppBadges {
  const out: AppBadges = {};
  const put = (id: AppId, count: number, strong = false) => { if (count > 0) out[id] = { count, strong }; };
  put('mail', i.mail);
  put('boards', i.counts?.by_app.boards ?? 0, (i.counts?.mentions ?? 0) > 0);
  put('rings', i.counts?.by_app.rings ?? 0);
  put('notifications', i.counts?.unread ?? 0);
  put('chat', i.chat, true);
  put('admin', i.counts?.by_app.admin ?? 0, true);
  return out;
}

// Which "mark these read" each icon offers.
export const READ_KINDS: Partial<Record<AppId, readonly string[] | 'mail'>> = {
  boards: ['reply', 'mention', 'watch', 'reaction'],
  rings: ['ring_invite', 'ring_request', 'ring_joined'],
  notifications: ['reply', 'mention', 'watch', 'reaction', 'mail', 'ring_invite', 'ring_request', 'ring_joined'],
  mail: 'mail',
};

let current: AppBadges = {};
const listeners = new Set<() => void>();
const same = (a: AppBadges, b: AppBadges) => JSON.stringify(a) === JSON.stringify(b);
export function setAppBadges(next: AppBadges): void {
  if (same(current, next)) return;
  current = next;
  for (const l of listeners) l();
}
export function useAppBadge(id: AppId): AppBadge | undefined {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current[id], () => undefined);
}

// Right-click "Mark these read" on an icon.
export async function markAppRead(qc: QueryClient, id: AppId): Promise<void> {
  const what = READ_KINDS[id];
  if (!what) return;
  if (what === 'mail') await api.post('/mail/read-all');
  else await api.post('/notifications/read', { kinds: what });
  await Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: ['mail'] })]);
}
