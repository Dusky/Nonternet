import { describe, expect, it } from 'vitest';
import { wrap } from './util';

describe('wrapping text for the terminal', () => {
  it('wraps at word boundaries, keeps blank lines, and breaks words longer than a line', () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps']);
    expect(wrap('one\n\ntwo', 10)).toEqual(['one', '', 'two']);
    expect(wrap('abcdefghijklmnop', 5)).toEqual(['abcde', 'fghij', 'klmno', 'p']);
    expect(wrap('café naïve', 4)).toEqual(['café', 'naïv', 'e']);
  });
});
