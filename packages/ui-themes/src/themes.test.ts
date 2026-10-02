import { describe, expect, it } from 'vitest';
import { TERMINAL_SCHEMES, THEMES } from '@app/shared';
import { contrast, isTerminalScheme, isThemeName, terminalPalette, terminalTokens, themeCss, themes, type Tokens } from './index';

// Every pair the interface actually draws text on.
const TEXT_PAIRS: [keyof Tokens, keyof Tokens][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface2'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface2'],
  ['accentText', 'accent'], ['fillText', 'fill'], ['popText', 'pop'], ['stickerText', 'sticker1'], ['stickerText', 'sticker2'],
  ['stickerText', 'sticker3'], ['stickerText', 'sticker4'], ['stickerText', 'sticker5'],
  ['titleText', 'titleBg'], ['titleActiveText', 'titleActiveBg'], ['taskbarText', 'taskbarBg'],
  ['danger', 'surface'], ['ok', 'surface'], ['warn', 'surface'], ['accent', 'surface'], ['accent', 'bg'],
  ['text', 'accentSoft'], ['accent', 'accentSoft'], ['text', 'desktopBg'],
];
// Edges people must see to use a control (WCAG 1.4.11): 3:1.
const EDGE_PAIRS: [keyof Tokens, keyof Tokens][] = [['lineStrong', 'surface'], ['lineStrong', 'bg'], ['focus', 'bg'], ['focus', 'surface']];

const variants = [
  ...Object.values(themes).filter((t) => t.name !== 'terminal').map((t) => ({ label: t.name, tokens: t.tokens })),
  ...TERMINAL_SCHEMES.map((s) => ({ label: `terminal (${s})`, tokens: terminalTokens(s) })),
];

describe('themes', () => {
  it('has exactly the themes the API accepts, and the Terminal schemes', () => {
    expect(Object.keys(themes).sort()).toEqual([...THEMES].sort());
    expect(isThemeName('webring')).toBe(true);
    expect(isThemeName('modern')).toBe(false);
    expect(isTerminalScheme('paper')).toBe(true);
    expect(isTerminalScheme('neon')).toBe(false);
  });

  for (const v of variants) {
    it(`${v.label}: text is readable (at least 4.5:1) and controls have visible edges (at least 3:1)`, () => {
      for (const [fg, bg] of TEXT_PAIRS) expect(contrast(v.tokens[fg], v.tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const [fg, bg] of EDGE_PAIRS) expect(contrast(v.tokens[fg], v.tokens[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }

  it('measures contrast correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('generates CSS for every theme and scheme, with no gaps', () => {
    const css = themeCss();
    for (const name of THEMES) expect(css).toContain(`:root[data-theme="${name}"]{`);
    for (const s of TERMINAL_SCHEMES) expect(css).toContain(`[data-scheme="${s}"]{`);
    expect(css).toContain('--accent-text:');
    expect(css).toContain('--sticker-1:');
    expect(css).not.toContain('undefined');
    expect(css).toMatch(/@media \(max-width: 699px\)\{:root\[data-theme="webring"\]\{--line-width:2px;/);
    expect(css).toContain(':root[data-theme="after-dark"]{--line-width:2px;');
  });

  it('starts every effect switched off', () => {
    for (const t of Object.values(themes)) expect(t.effects).toEqual({ scanlines: false, glow: false, crt: false });
  });

  it('gives the Terminal window 16 readable colours in every screen colour', () => {
    for (const s of TERMINAL_SCHEMES) {
      const p = terminalPalette(s);
      expect(p.colours, s).toHaveLength(16);
      expect(contrast(p.foreground, p.background), `${s} text`).toBeGreaterThanOrEqual(4.5);
      // everything but black (0) can be read on the background
      p.colours.slice(1).forEach((c, i) => expect(contrast(c, p.background), `${s} colour ${i + 1}`).toBeGreaterThanOrEqual(3));
    }
  });
});
