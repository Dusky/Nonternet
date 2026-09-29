import { describe, expect, it } from 'vitest';
import { THEMES } from '@app/shared';
import { contrast, isThemeName, themeCss, themes, type Tokens } from './index';

// Every pair the interface actually draws text on.
const PAIRS: [keyof Tokens, keyof Tokens][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface2'], ['muted', 'bg'], ['muted', 'surface'],
  ['accentText', 'accent'], ['titleText', 'titleBg'], ['taskbarText', 'taskbarBg'],
  ['danger', 'surface'], ['ok', 'surface'], ['focus', 'bg'], ['focus', 'surface'],
];

const variants = Object.values(themes).flatMap((t) => [
  { label: `${t.name}`, tokens: t.tokens, min: t.name === 'amber' ? 7 : 4.5 }, // retro themes offer high contrast
  ...(t.dark ? [{ label: `${t.name} (dark)`, tokens: t.dark, min: 4.5 }] : []),
]);

describe('themes', () => {
  it('has exactly the themes the API accepts', () => {
    expect(Object.keys(themes).sort()).toEqual([...THEMES].sort());
    expect(isThemeName('amber')).toBe(true);
    expect(isThemeName('neon')).toBe(false);
  });

  for (const v of variants) {
    it(`${v.label}: text is readable (contrast at least ${v.min}:1 on every surface it is drawn on)`, () => {
      for (const [fg, bg] of PAIRS) {
        expect(contrast(v.tokens[fg], v.tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(v.min);
      }
    });
  }

  it('measures contrast correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('generates CSS for every theme, with a dark variant for modern', () => {
    const css = themeCss();
    for (const name of THEMES) expect(css).toContain(`:root[data-theme="${name}"]`);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('--accent-text:');
    expect(css).not.toContain('undefined');
  });

  it('keeps retro effects individually switchable and off for modern', () => {
    expect(themes.amber.effects).toEqual({ scanlines: true, glow: true });
    expect(themes.modern.effects).toEqual({ scanlines: false, glow: false });
  });
});
