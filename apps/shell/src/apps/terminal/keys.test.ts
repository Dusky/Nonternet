import { describe, expect, it } from 'vitest';
import { chunkInput, withModifiers } from './TerminalApp';
import { parsePrefs } from '../../devicePrefs';

describe('on-screen Ctrl and Alt', () => {
  it('turns Ctrl+letter into the control byte and puts Escape before an Alt key', () => {
    expect(withModifiers('c', { ctrl: true, alt: false })).toBe('\x03');
    expect(withModifiers('Z', { ctrl: true, alt: false })).toBe('\x1a');
    expect(withModifiers(' ', { ctrl: true, alt: false })).toBe('\x00');
    expect(withModifiers('x', { ctrl: false, alt: true })).toBe('\x1bx');
    expect(withModifiers('\x1b[A', { ctrl: true, alt: false })).toBe('\x1b[A'); // longer sequences pass through
  });
});

describe('terminal preferences on this device', () => {
  it('keeps known values and falls back for anything odd', () => {
    expect(parsePrefs('terminal', JSON.stringify({ scrollback: 5000, bell: 'sound', copyOnSelect: true }))).toMatchObject({ scrollback: 5000, bell: 'sound', copyOnSelect: true, fontSize: 16 });
    expect(parsePrefs('terminal', JSON.stringify({ scrollback: 123, bell: 'loud' }))).toMatchObject({ scrollback: 2000, bell: 'flash' });
  });
});

describe('long input', () => {
  it('goes in pieces the BBS will take whole, without splitting an emoji', () => {
    const big = 'a'.repeat(9000);
    const parts = chunkInput(big);
    expect(parts.map((p) => p.length)).toEqual([4000, 4000, 1000]);
    expect(parts.join('')).toBe(big);
    const emoji = `${'a'.repeat(3)}😀b`;
    expect(chunkInput(emoji, 4)).toEqual(['aaa', '😀b']);
    expect(chunkInput('')).toEqual([]);
  });
});
