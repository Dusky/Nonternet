import { describe, expect, it } from 'vitest';
import { APP_PAGES, asPageNumber, pageOf, pageTarget } from './pages';
import { addRecent, RECENT_MAX, type RecentPlace } from './recent';
import { linkFromDrop, placeForUrl } from './dropLink';

const boards = [{ slug: 'synths', page: 201 }, { slug: 'lounge', page: 202 }, { slug: 'old', page: null }];

describe('page numbers', () => {
  it('gives every app its own number', () => {
    expect(new Set(Object.values(APP_PAGES)).size).toBe(Object.keys(APP_PAGES).length);
  });
  it('turns a number into a place and back', () => {
    expect(pageTarget(200, boards)).toEqual({ app: 'boards', path: '' });
    expect(pageTarget(100, boards)).toEqual({ app: 'home', path: '' });
    expect(pageTarget(201, boards)).toEqual({ app: 'boards', path: 'synths' });
    expect(pageTarget(902, boards)).toEqual({ app: 'settings', path: 'appearance' });
    expect(pageTarget(777, boards)).toBeNull();
    expect(pageOf('boards', 'synths/t/p_1', boards)).toBe(201);
    expect(pageOf('mail', '', boards)).toBe(300);
    expect(pageOf('settings', 'appearance', boards)).toBe(902);
    expect(pageOf('mail', 'c_1', boards)).toBeNull();
  });
  it('reads three or four digits as a page number, nothing else', () => {
    expect(asPageNumber(' 201 ')).toBe(201);
    expect(asPageNumber('2100')).toBe(2100);
    expect(asPageNumber('20')).toBeNull();
    expect(asPageNumber('201a')).toBeNull();
  });
});

describe('recent places', () => {
  const p = (path: string): Omit<RecentPlace, 'at'> => ({ app: 'boards', path, label: path });
  it('puts the newest first, keeps one of each and stops at the limit', () => {
    let list: RecentPlace[] = [];
    for (let i = 0; i < RECENT_MAX + 3; i++) list = addRecent(list, p(`b${i}`), i);
    expect(list).toHaveLength(RECENT_MAX);
    list = addRecent(list, p('b5'), 99);
    expect(list[0]!.path).toBe('b5');
    expect(list.filter((r) => r.path === 'b5')).toHaveLength(1);
  });
  it('ignores a screen with no place or no name', () => {
    expect(addRecent([], { app: 'boards', path: '', label: 'x' })).toEqual([]);
    expect(addRecent([], { app: 'boards', path: 'x', label: '' })).toEqual([]);
  });
});

describe('dropping a link', () => {
  const dt = (data: Record<string, string>) => ({ getData: (k: string) => data[k] ?? '' });
  it('reads the address and title a browser gives', () => {
    expect(linkFromDrop(dt({ 'text/x-moz-url': 'https://example.org/a\nA page' }))).toEqual({ url: 'https://example.org/a', title: 'A page' });
    expect(linkFromDrop(dt({ 'text/uri-list': '# comment\r\nhttps://example.org/b' }))).toEqual({ url: 'https://example.org/b', title: '' });
    expect(linkFromDrop(dt({ 'text/plain': 'just words' }))).toBeNull();
    expect(linkFromDrop(dt({ 'text/plain': 'javascript:alert(1)' }))).toBeNull();
  });
  it('turns a link to this site into a place, and leaves other sites alone', () => {
    expect(placeForUrl('https://site.test/boards/synths/t/p_1', 'https://site.test')).toEqual({ app: 'boards', path: 'synths/t/p_1' });
    expect(placeForUrl('https://site.test/mail', 'https://site.test')).toEqual({ app: 'mail', path: '' });
    expect(placeForUrl('https://elsewhere.test/boards/x', 'https://site.test')).toBeNull();
    expect(placeForUrl('https://site.test/nothing-here', 'https://site.test')).toBeNull();
  });
});
