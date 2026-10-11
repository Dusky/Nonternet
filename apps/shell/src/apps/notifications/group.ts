import type { NotificationView } from '@app/shared';
import { dayKey } from '../chat/helpers';

// What the Notifications page shows: the list cut into days, with replies to the same thread next to each other folded
// into one line ("Ada and 2 others replied"). Pure, so it is tested on its own.
export interface NotificationGroup { day: string; first: NotificationView; items: NotificationView[]; others: number }

export function groupNotifications(list: NotificationView[]): { day: string; at: string; groups: NotificationGroup[] }[] {
  const days: { day: string; at: string; groups: NotificationGroup[] }[] = [];
  for (const n of list) {
    const day = dayKey(Date.parse(n.at));
    let d = days[days.length - 1];
    if (!d || d.day !== day) { d = { day, at: n.at, groups: [] }; days.push(d); }
    const prev = d.groups[d.groups.length - 1];
    const sameThread = prev && n.kind === 'reply' && prev.first.kind === 'reply' && prev.first.link.to === n.link.to && prev.first.read === n.read;
    if (sameThread) {
      prev.items.push(n);
      prev.others = new Set(prev.items.map((x) => x.actor.id)).size - 1;
    } else d.groups.push({ day, first: n, items: [n], others: 0 });
  }
  return days;
}
