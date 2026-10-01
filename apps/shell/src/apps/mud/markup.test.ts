import { describe, expect, it } from 'vitest';
import { parseMarkup, plainText } from './markup';

describe('Evennia markup', () => {
  it('colours text and resets', () => {
    expect(parseMarkup('|cLimbo(#2)|n rest')).toEqual([[{ text: 'Limbo(#2)', fg: 'cyan', bright: true }, { text: ' rest' }]]);
    expect(parseMarkup('|Rdark red')).toEqual([[{ text: 'dark red', fg: 'red', bright: false }]]);
    expect(parseMarkup('|500hot|n')).toEqual([[{ text: 'hot', rgb: [5, 0, 0] }]]);
  });

  it('splits lines on newlines and |/, and keeps literal bars', () => {
    expect(plainText('one\ntwo|/three')).toBe('one\ntwo\nthree');
    expect(plainText('a || b')).toBe('a | b');
    expect(plainText('x|-y|_z')).toBe('x    y z');
  });

  it('keeps the text of links and drops backgrounds and effects', () => {
    expect(plainText('go |lcnorth|ltNorth|le now')).toBe('go North now');
    expect(plainText('|[rred background|n |hhi|H')).toBe('red background hi');
    expect(parseMarkup('|uunder|n')).toEqual([[{ text: 'under', underline: true }]]);
  });

  it('understands the ANSI codes Evennia mixes into its menus', () => {
    const menu = '\x1b[0m |lc3|lt\x1b[1m\x1b[37m3\x1b[0m|le: \x1b[1m\x1b[37m\x1b[0mAccept \x1b[1m\x1b[37m\x1b[0mand create';
    expect(plainText(menu)).toBe(' 3: Accept and create');
    expect(parseMarkup('\x1b[31mred\x1b[0m plain')).toEqual([[{ text: 'red', fg: 'red' }, { text: ' plain' }]]);
  });

  it('turns Evennia\'s HTML entities back into the characters, as plain text', () => {
    expect(plainText('public &lt;text&gt; - talk. You don&#x27;t have one &amp; that&#39;s fine &quot;ok&quot;')).toBe('public <text> - talk. You don\'t have one & that\'s fine "ok"');
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('<script>alert(1)</script>'); // still only ever text
  });

  it('never produces markup from what people type', () => {
    expect(plainText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});
