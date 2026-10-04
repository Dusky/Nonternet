import { describe, expect, it } from 'vitest';
import { bold, cut, pad, width, wrap } from './util';

describe('wrapping text for the terminal', () => {
  it('wraps at word boundaries, keeps blank lines, and breaks words longer than a line', () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps']);
    expect(wrap('one\n\ntwo', 10)).toEqual(['one', '', 'two']);
    expect(wrap('abcdefghijklmnop', 5)).toEqual(['abcde', 'fghij', 'klmno', 'p']);
    expect(wrap('café naïve', 4)).toEqual(['café', 'naïv', 'e']);
  });
});

describe('measuring coloured text', () => {
  it('pads and cuts by what shows on screen, never cutting a colour code in half', () => {
    const two = bold('2');
    expect(width(two)).toBe(1);
    expect(pad(two, 8)).toBe(`${two}       `);
    expect(pad(bold('abcdef'), 3)).toBe('\x1b[1mabc\x1b[0m');
    expect(cut(`${bold('hello')} world`, 4)).toBe('\x1b[1mhel\x1b[0m…');
    expect(pad('plain', 3)).toBe('pla');
  });
});
