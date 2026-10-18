import { describe, expect, it } from 'vitest';
import { bold, cut, pad, tableHead, tableRow, width, wrap, type Column } from './util';

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

describe('tables that fit the screen', () => {
  const cols: Column[] = [{ label: 'Node', width: 6, narrowLabel: 'node' }, { label: 'Handle', width: 20, main: true }, { label: 'Where', width: 50 }];
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  it('keeps the usual columns at 80', () => {
    expect(strip(tableHead(80, cols))).toBe(`${'Node'.padEnd(6)}${'Handle'.padEnd(20)}Where`);
    expect(tableRow(80, cols, ['1', 'ada', 'Reading boards (web)'])).toEqual([`1     ada                 Reading boards (web)`]);
  });
  it('turns each row into two lines on a phone, nothing wider than the screen', () => {
    const lines = tableRow(33, cols, ['1', 'person05f67c', "Who's online (web)"]);
    expect(lines.map(strip)).toEqual(['person05f67c', "   node 1 · Who's online (web)"]);
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(32);
    expect(strip(tableHead(33, cols))).toBe('Handle, then Node · Where');
    // Long text is cut, never wrapped into the next row.
    const long = tableRow(33, cols, ['2', 'h'.repeat(40), 'w'.repeat(80)]);
    for (const l of long) expect(width(l)).toBeLessThanOrEqual(32);
    // Empty and "-" details are left out.
    expect(tableRow(33, cols, ['-', 'bob', 'on the web']).map(strip)).toEqual(['bob', '   on the web']);
  });

  it('measures wide characters as two columns and never splits one', () => {
    expect(width('日本語')).toBe(6);
    expect(width('héllo')).toBe(5);
    expect(width('👍🏽')).toBe(2);
    expect(width('\x1b[1m漢字\x1b[0m')).toBe(4);
    expect(pad('日本語', 5)).toBe('日本 ');      // the third would only half fit: dropped, and a space keeps the column
    expect(width(pad('日本語', 5))).toBe(5);
    expect(cut('こんにちは世界', 8)).toBe('こんに…');
    expect(wrap('日本語の文章', 5).every((l) => width(l) <= 5)).toBe(true);
    expect(wrap('日本語の文章', 5).join('')).toBe('日本語の文章');
  });
});
