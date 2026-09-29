import { describe, expect, it } from 'vitest';
import { initials, quoteReply } from './quote';

describe('initials', () => {
  it('takes the first letters of two words, or the first two letters of one', () => {
    expect(initials('zero_cool')).toBe('ZC');
    expect(initials('Zero Cool')).toBe('ZC');
    expect(initials('alice')).toBe('AL');
    expect(initials('x')).toBe('X');
  });
});

describe('quoteReply', () => {
  it('prefixes each line with the initials and leaves a blank line to reply in', () => {
    expect(quoteReply('zerocool', 'one\n\ntwo')).toBe('ZE> one\nZE>\nZE> two\n\n');
  });
  it('keeps the initials of someone quoted earlier', () => {
    expect(quoteReply('bob', 'AL> hello\nmy reply')).toBe('AL> hello\nBO> my reply\n\n');
  });
  it('wraps long lines to the terminal width, keeping the prefix', () => {
    const out = quoteReply('bob', 'word '.repeat(40).trim());
    const lines = out.trim().split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.startsWith('BO> ') && [...l].length <= 79)).toBe(true);
  });
});
