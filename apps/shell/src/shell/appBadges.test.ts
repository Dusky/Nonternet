import { describe, expect, it } from 'vitest';
import { badgeMap, badgeText } from './appBadges';

const counts = (o: Partial<{ unread: number; boards: number; rings: number; admin: number; mentions: number }>) => ({
  unread: o.unread ?? 0, mentions: o.mentions ?? 0, by_app: { boards: o.boards ?? 0, rings: o.rings ?? 0, ...(o.admin !== undefined ? { admin: o.admin } : {}) },
});

describe('badgeMap', () => {
  it('shows nothing when nothing is waiting', () => {
    expect(badgeMap({ mail: 0, chat: 0, counts: counts({}) })).toEqual({});
  });
  it('splits the counts by app and marks mentions, chat and reports as strong', () => {
    const m = badgeMap({ mail: 2, chat: 1, counts: counts({ unread: 5, boards: 3, mentions: 1, rings: 1, admin: 4 }) });
    expect(m.mail).toEqual({ count: 2, strong: false });
    expect(m.boards).toEqual({ count: 3, strong: true });
    expect(m.rings).toEqual({ count: 1, strong: false });
    expect(m.chat).toEqual({ count: 1, strong: true });
    expect(m.admin).toEqual({ count: 4, strong: true });
    expect(m.notifications).toEqual({ count: 5, strong: false });
  });
  it('keeps Boards plain when there is no mention', () => {
    expect(badgeMap({ mail: 0, chat: 0, counts: counts({ boards: 2 }) }).boards?.strong).toBe(false);
  });
  it('caps big numbers at 99+', () => {
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});
