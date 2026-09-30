import { describe, expect, it } from 'vitest';
import { mentions, parseFormatting, stripFormatting } from './format';

describe('mIRC formatting', () => {
  it('turns control codes into styled segments', () => {
    expect(parseFormatting('a \x02bold\x02 b')).toEqual([{ text: 'a ' }, { text: 'bold', bold: true }, { text: ' b' }]);
    expect(parseFormatting('\x034,1red on black\x0f plain')).toEqual([{ text: 'red on black', fg: 4, bg: 1 }, { text: ' plain' }]);
    expect(parseFormatting('\x0312blue\x03 back')).toEqual([{ text: 'blue', fg: 12 }, { text: ' back' }]);
    expect(parseFormatting('\x1ditalic\x1d\x1funder\x1f\x1estrike')).toEqual([{ text: 'italic', italic: true }, { text: 'under', underline: true }, { text: 'strike', strike: true }]);
  });

  it('keeps digits after a colour code that are not part of it', () => {
    expect(parseFormatting('\x03041 apple')).toEqual([{ text: '1 apple', fg: 4 }]);
    expect(parseFormatting('\x03,5x')).toEqual([{ text: ',5x' }]); // a comma alone is text
  });

  it('ignores colours beyond the classic 16 rather than guessing', () => {
    expect(parseFormatting('\x0350,99odd')).toEqual([{ text: 'odd' }]);
  });

  it('finds links, leaving trailing punctuation out', () => {
    expect(parseFormatting('see https://example.org/a?b=1, ok')).toEqual([
      { text: 'see ' }, { text: 'https://example.org/a?b=1', link: 'https://example.org/a?b=1' }, { text: ', ok' },
    ]);
    expect(parseFormatting('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }]);
  });

  it('strips codes and spots mentions as whole words', () => {
    expect(stripFormatting('\x02hi\x02 \x034there')).toBe('hi there');
    expect(mentions('hey Zero, look', 'zero')).toBe(true);
    expect(mentions('\x02zero\x02: hi', 'zero')).toBe(true);
    expect(mentions('zerocool is here', 'zero')).toBe(false);
    expect(mentions('ask [zero]', 'zero')).toBe(false); // brackets are nick characters on IRC
  });
});
