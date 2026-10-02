import { describe, expect, it } from 'vitest';
import { completeNick, completeWord, dayKey, dayLabel, nickColour, splitPaste, typingNow } from './helpers';

const nicks = ['alice', 'Alma', 'bob'];

describe('completeNick', () => {
  it('finishes the word before the caret, adding ": " at the start of a line', () => {
    const c = completeNick('al', 2, nicks, null)!;
    expect(c.text).toBe('alice: ');
    expect(c.caret).toBe(7);
  });
  it('adds a plain space mid-line and keeps what follows', () => {
    const c = completeNick('hi bo there', 5, nicks, null)!;
    expect(c.text).toBe('hi bob  there');
    expect(c.caret).toBe(7);
  });
  it('matches without regard to case and says nothing when there is no match', () => {
    expect(completeNick('AL', 2, nicks, null)!.matches).toEqual(['alice', 'Alma']);
    expect(completeNick('zz', 2, nicks, null)).toBeNull();
    expect(completeNick('hello ', 6, nicks, null)).toBeNull();
  });
  it('steps through the matches on repeated Tab', () => {
    const a = completeNick('al', 2, nicks, null)!;
    const b = completeNick(a.text, a.caret, nicks, a)!;
    expect(b.text).toBe('Alma: ');
    const c = completeNick(b.text, b.caret, nicks, b)!;
    expect(c.text).toBe('alice: ');
  });
});

describe('days and typing', () => {
  const now = new Date(2026, 9, 1, 12).getTime();
  const words = { today: 'Today', yesterday: 'Yesterday' };
  it('names today and yesterday and dates the rest', () => {
    expect(dayLabel(now - 3_600_000, now, words)).toBe('Today');
    expect(dayLabel(now - 86_400_000, now, words)).toBe('Yesterday');
    expect(dayLabel(now - 5 * 86_400_000, now, words)).not.toMatch(/Today|Yesterday/);
    expect(dayKey(now)).toBe('2026-10-1');
  });
  it('lists only people whose typing has not run out, sorted', () => {
    const m = new Map([['zed', now + 1000], ['amy', now + 500], ['old', now - 1]]);
    expect(typingNow(m, now)).toEqual(['amy', 'zed']);
  });
});

describe('completeWord', () => {
  it('finishes a channel or command with a plain space and cycles', () => {
    const a = completeWord('join #sy', 8, ['#synths', '#symbols', '#lobby'], null)!;
    expect(a.text).toBe('join #symbols ');
    const b = completeWord(a.text, a.caret, ['#synths', '#symbols', '#lobby'], a)!;
    expect(b.text).toBe('join #synths ');
    expect(completeWord('/wh', 3, ['/whois', '/join'], null)!.text).toBe('/whois ');
    expect(completeWord('/zz', 3, ['/whois'], null)).toBeNull();
  });
});

describe('nickColour', () => {
  it('is stable and one of five', () => {
    expect(nickColour('Alice')).toBe(nickColour('alice'));
    for (const n of ['a', 'bob', 'carol', 'dave', 'eve']) expect(nickColour(n)).toMatch(/^chat-nc-[0-4]$/);
  });
});

describe('splitPaste', () => {
  it('leaves one line alone and splits several, dropping blanks', () => {
    expect(splitPaste('hello')).toBeNull();
    expect(splitPaste('hello\n')).toBeNull();
    expect(splitPaste('one\r\n\ntwo  \nthree')).toEqual(['one', 'two', 'three']);
    expect(splitPaste(`a\n${'x'.repeat(500)}`)![1]).toHaveLength(400);
  });
});
