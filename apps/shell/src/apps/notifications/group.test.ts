import { describe, expect, it } from 'vitest';
import type { NotificationView } from '@app/shared';
import { groupNotifications } from './group';

const n = (id: string, kind: string, at: string, to: string, actor: string, read = false): NotificationView => ({
  id, kind: kind as NotificationView['kind'], at, read, count: 1, subject: '', place: '', link: { app: 'boards', to }, actor: { id: actor, handle: actor, display_name: null },
});

describe('groupNotifications', () => {
  it('cuts the list into days and folds neighbouring replies to one thread', () => {
    const days = groupNotifications([
      n('1', 'reply', '2026-10-11T10:00:00Z', 'a/t/1', 'ada'),
      n('2', 'reply', '2026-10-11T09:00:00Z', 'a/t/1', 'bo'),
      n('3', 'reply', '2026-10-11T08:00:00Z', 'a/t/1', 'ada'),
      n('4', 'mail', '2026-10-11T07:00:00Z', 'm1', 'cy'),
      n('5', 'reply', '2026-10-10T07:00:00Z', 'a/t/1', 'cy'),
    ]);
    expect(days).toHaveLength(2);
    expect(days[0]!.groups.map((g) => [g.first.id, g.items.length, g.others])).toEqual([['1', 3, 1], ['4', 1, 0]]);
    expect(days[1]!.groups[0]!.first.id).toBe('5');
  });
  it('keeps read and unread apart, and other threads apart', () => {
    const days = groupNotifications([
      n('1', 'reply', '2026-10-11T10:00:00Z', 'a/t/1', 'ada'),
      n('2', 'reply', '2026-10-11T09:00:00Z', 'a/t/1', 'bo', true),
      n('3', 'reply', '2026-10-11T08:00:00Z', 'a/t/2', 'bo', true),
    ]);
    expect(days[0]!.groups.map((g) => g.items.length)).toEqual([1, 1, 1]);
  });
});
