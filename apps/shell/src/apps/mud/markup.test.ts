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

  it('never produces markup from what people type', () => {
    expect(plainText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});
