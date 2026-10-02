import { TERMINAL_SCHEMES, type TerminalScheme, type ThemeName } from '@app/shared';

// Themes are token sets (docs/10). They style the chrome; the words in the interface follow the
// plain voice in every theme. Every text/background pair below is checked against WCAG AA (4.5:1) in
// the tests, in every theme and every Terminal colour scheme.

export type Tokens = Record<
  // Colours. `accent` is the colour of links and highlighted words (readable on surfaces); `fill` is the
  // colour of primary buttons, the focused window's title bar and selected tabs, with `fillText` on it.
  | 'bg' | 'surface' | 'surface2' | 'text' | 'muted' | 'border' | 'accent' | 'accentText'
  | 'accentSoft' | 'danger' | 'ok' | 'warn' | 'focus' | 'lineStrong' | 'fill' | 'fillText' | 'pop' | 'popText'
  | 'sticker1' | 'sticker2' | 'sticker3' | 'sticker4' | 'sticker5' | 'stickerText'
  // Window and desktop chrome.
  | 'titleBg' | 'titleText' | 'titleActiveBg' | 'titleActiveText' | 'titleImage' | 'taskbarBg' | 'taskbarText'
  | 'desktopBg' | 'desktopDot' | 'winBtnRadius'
  // Type.
  | 'fontBody' | 'fontMono' | 'fontDisplay' | 'fontLabel' | 'fontNumber'
  // Shape: corners, outline widths, shadows (soft or hard, by theme), a small tilt for stickers.
  | 'radius' | 'radiusSm' | 'radiusLg' | 'lineWidth' | 'controlLine'
  | 'shadow' | 'shadowSm' | 'shadowHard' | 'shadowCard' | 'shadowWindow' | 'glow' | 'tilt',
  string
>;

// Which family of window chrome a theme draws (a few rules in the stylesheet key on it).
export type Chrome = 'zine' | 'terminal' | 'platinum' | 'aqua';

export interface Theme {
  name: ThemeName;
  label: string;
  chrome: Chrome;
  scheme: 'light' | 'dark';
  tokens: Tokens;
  // Optional effects. All start off; each is a switch in Settings → Appearance.
  effects: { scanlines: boolean; glow: boolean; crt: boolean };
}

// Font families are bundled with the shell (open licences, docs/17 V10); system fonts follow as fallbacks.
const sans = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const mono = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace`;
const bricolage = `'Bricolage Grotesque', ${sans}`;
const spaceMono = `'Space Mono', ${mono}`;
const plexMono = `'IBM Plex Mono', ${mono}`;
const plexSans = `'IBM Plex Sans', ${sans}`;
const vt323 = `'VT323', ${mono}`;
const pixelify = `'Pixelify Sans', ${mono}`;
const nunito = `'Nunito Sans', ${sans}`;
export const FONT_PIXEL = `'Silkscreen', ${mono}`;

const offset = (px: number, colour: string) => `${px}px ${px}px 0 ${colour}`;

// Webring: the zine on cream paper. Black outlines, hard black shadows, sticker colours. The default.
const webring: Tokens = {
  bg: '#fff3c4', surface: '#ffffff', surface2: '#fffbe8', text: '#141414', muted: '#4a4030', border: '#d9c98f',
  accent: '#3d1fd1', accentText: '#ffffff', accentSoft: '#ece6ff', danger: '#b42318', ok: '#1f6b40', warn: '#7d5300',
  focus: '#3d1fd1', lineStrong: '#141414', fill: '#ff4fa0', fillText: '#141414', pop: '#ff4fa0', popText: '#141414',
  sticker1: '#ffe14d', sticker2: '#c9f2ff', sticker3: '#ffd1e6', sticker4: '#d9ff8a', sticker5: '#e3d6ff', stickerText: '#141414',
  titleBg: '#fffbe8', titleText: '#4a4030', titleActiveBg: '#ff4fa0', titleActiveText: '#141414', titleImage: 'none',
  taskbarBg: '#141414', taskbarText: '#fff3c4', desktopBg: '#fff3c4', desktopDot: '#e8c96a', winBtnRadius: '0',
  fontBody: bricolage, fontMono: spaceMono, fontDisplay: bricolage, fontLabel: spaceMono, fontNumber: bricolage,
  radius: '0', radiusSm: '0', radiusLg: '0', lineWidth: '3px', controlLine: '2px',
  shadow: offset(6, '#141414'), shadowSm: offset(3, '#141414'), shadowHard: offset(3, '#141414'), shadowCard: offset(5, '#141414'),
  shadowWindow: offset(8, '#141414'), glow: 'none', tilt: '-1deg',
};

// After dark: the same zine, lit by an amber screen. Amber outlines and shadows, magenta for what is new.
const afterDark: Tokens = {
  bg: '#120c02', surface: '#1d1406', surface2: '#2a1d09', text: '#f6e3c0', muted: '#c9a46a', border: '#5a3d10',
  accent: '#ffb43a', accentText: '#120c02', accentSoft: '#33240a', danger: '#ff8a6b', ok: '#8fe36b', warn: '#ffd166',
  focus: '#2bd2ff', lineStrong: '#ffb43a', fill: '#ffb43a', fillText: '#120c02', pop: '#ff5fae', popText: '#120c02',
  sticker1: '#ffb43a', sticker2: '#ff5fae', sticker3: '#2bd2ff', sticker4: '#b8f400', sticker5: '#ffe2a0', stickerText: '#120c02',
  titleBg: '#2a1d09', titleText: '#c9a46a', titleActiveBg: '#ffb43a', titleActiveText: '#120c02', titleImage: 'none',
  taskbarBg: '#120c02', taskbarText: '#ffb43a', desktopBg: '#120c02', desktopDot: '#3a2706', winBtnRadius: '0',
  fontBody: bricolage, fontMono: spaceMono, fontDisplay: bricolage, fontLabel: spaceMono, fontNumber: vt323,
  radius: '0', radiusSm: '0', radiusLg: '0', lineWidth: '3px', controlLine: '2px',
  shadow: offset(6, '#ffb43a'), shadowSm: offset(3, '#ffb43a'), shadowHard: offset(3, '#ff5fae'), shadowCard: offset(5, '#ffb43a'),
  shadowWindow: offset(8, '#ffb43a'), glow: '0 0 6px rgba(255,180,58,.5)', tilt: '-1deg',
};

// Terminal: the BBS everywhere. Each scheme is a phosphor colour; the tokens are worked out from a few base colours.
interface SchemeBase { bg: string; surface: string; surface2: string; ink: string; dim: string; accent: string; line: string; border: string; focus: string; danger: string; ok: string; warn: string; light?: boolean }
export const TERMINAL_SCHEME_BASES: Record<TerminalScheme, SchemeBase> = {
  amber: { bg: '#120c02', surface: '#1a1205', surface2: '#24180a', ink: '#ffb43a', dim: '#b98a3e', accent: '#ffe2a0', line: '#b98a3e', border: '#5a3d10', focus: '#2bd2ff', danger: '#ff8a6b', ok: '#8fe36b', warn: '#ffd166' },
  green: { bg: '#050b05', surface: '#0a140a', surface2: '#0f1c0f', ink: '#8ef58a', dim: '#5fa85c', accent: '#d8ffcf', line: '#5fa85c', border: '#234a22', focus: '#ffe14d', danger: '#ff8a6b', ok: '#d8ffcf', warn: '#ffd166' },
  white: { bg: '#0f1012', surface: '#17181b', surface2: '#1f2024', ink: '#e7e5dc', dim: '#a3a198', accent: '#ffb43a', line: '#a3a198', border: '#3a3b3f', focus: '#2bd2ff', danger: '#ff8a6b', ok: '#8fe36b', warn: '#ffd166' },
  ice: { bg: '#03111b', surface: '#071a28', surface2: '#0b2335', ink: '#7fd6ff', dim: '#56a2c4', accent: '#ffffff', line: '#56a2c4', border: '#12405a', focus: '#ffe14d', danger: '#ff8a6b', ok: '#8fe36b', warn: '#ffd166' },
  ansi: { bg: '#0b0d2a', surface: '#12153a', surface2: '#191d4a', ink: '#e6e6ff', dim: '#9fa3d6', accent: '#4fe0ff', line: '#9fa3d6', border: '#3a3f9a', focus: '#ffe14d', danger: '#ff8a8a', ok: '#7dff9c', warn: '#ffe14d' },
  'amber-magenta': { bg: '#150a12', surface: '#1e0f19', surface2: '#27141f', ink: '#ffb43a', dim: '#c9946a', accent: '#ff5fae', line: '#c9946a', border: '#5a2a44', focus: '#2bd2ff', danger: '#ff8a6b', ok: '#8fe36b', warn: '#ffd166' },
  paper: { bg: '#f5ecd6', surface: '#fbf5e6', surface2: '#efe4c8', ink: '#3b2a10', dim: '#6a5535', accent: '#a33b08', line: '#6a5535', border: '#c9b48a', focus: '#1f4fd6', danger: '#a3200f', ok: '#1f6b40', warn: '#6b4800', light: true },
  dusk: { bg: '#1c1712', surface: '#241e17', surface2: '#2d261d', ink: '#e8c48a', dim: '#b09a74', accent: '#ffd28a', line: '#b09a74', border: '#4a3d2c', focus: '#2bd2ff', danger: '#ff8a6b', ok: '#8fe36b', warn: '#ffd166' },
};

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export function terminalTokens(scheme: TerminalScheme): Tokens {
  const s = TERMINAL_SCHEME_BASES[scheme];
  return {
    bg: s.bg, surface: s.surface, surface2: s.surface2, text: s.ink, muted: s.dim, border: s.border,
    accent: s.accent, accentText: s.bg, accentSoft: s.surface2, danger: s.danger, ok: s.ok, warn: s.warn,
    focus: s.focus, lineStrong: s.line, fill: s.ink, fillText: s.bg, pop: s.accent, popText: s.bg,
    sticker1: s.surface2, sticker2: s.surface2, sticker3: s.surface2, sticker4: s.surface2, sticker5: s.surface2, stickerText: s.ink,
    titleBg: s.surface2, titleText: s.dim, titleActiveBg: s.ink, titleActiveText: s.bg, titleImage: 'none',
    taskbarBg: s.bg, taskbarText: s.ink, desktopBg: s.bg, desktopDot: s.surface2, winBtnRadius: '0',
    fontBody: plexMono, fontMono: plexMono, fontDisplay: vt323, fontLabel: plexMono, fontNumber: vt323,
    radius: '0', radiusSm: '0', radiusLg: '0', lineWidth: '1px', controlLine: '1px',
    shadow: 'none', shadowSm: 'none', shadowHard: 'none', shadowCard: 'none', shadowWindow: `0 0 0 1px ${s.border}`,
    glow: s.light ? 'none' : `0 0 6px ${rgba(s.ink, 0.5)}`, tilt: '0deg',
  };
}

// Platinum: a late-90s desktop. Grey bevels, striped title bars, a teal desktop.
const bevelOut = 'inset -2px -2px 0 #9a9a9a, inset 2px 2px 0 #ffffff';
const platinum: Tokens = {
  bg: '#dcdcdc', surface: '#ffffff', surface2: '#e8e8e8', text: '#111111', muted: '#444444', border: '#9a9a9a',
  accent: '#1f3fa8', accentText: '#ffffff', accentSoft: '#dfe6fb', danger: '#a01818', ok: '#1f6b2c', warn: '#6b4a00',
  focus: '#1f3fa8', lineStrong: '#000000', fill: '#e4e4e4', fillText: '#111111', pop: '#1f3fa8', popText: '#ffffff',
  sticker1: '#e4e4e4', sticker2: '#e4e4e4', sticker3: '#e4e4e4', sticker4: '#e4e4e4', sticker5: '#e4e4e4', stickerText: '#111111',
  titleBg: '#dcdcdc', titleText: '#555555', titleActiveBg: '#dcdcdc', titleActiveText: '#111111',
  titleImage: 'repeating-linear-gradient(#dcdcdc 0 1px, #9c9c9c 1px 2px)',
  taskbarBg: '#e4e4e4', taskbarText: '#111111', desktopBg: '#6aadad', desktopDot: '#5b9c9c', winBtnRadius: '0',
  fontBody: plexSans, fontMono: plexMono, fontDisplay: pixelify, fontLabel: plexSans, fontNumber: pixelify,
  radius: '0', radiusSm: '4px', radiusLg: '0', lineWidth: '1px', controlLine: '1px',
  shadow: '3px 3px 0 rgba(0,0,0,.35)', shadowSm: bevelOut, shadowHard: bevelOut, shadowCard: 'inset 2px 2px 0 #9a9a9a',
  shadowWindow: `inset -1px -1px 0 #808080, inset 1px 1px 0 #ffffff, 3px 3px 0 rgba(0,0,0,.35)`, glow: 'none', tilt: '0deg',
};

// Aqua: the glossy turn of the century. Pinstripes, soft translucent windows, gel buttons.
const aqua: Tokens = {
  bg: '#dfe6ee', surface: '#ffffff', surface2: '#f1f5fa', text: '#1b2430', muted: '#4a5664', border: '#c3ccd7',
  accent: '#0b5bd3', accentText: '#ffffff', accentSoft: '#dbe8fb', danger: '#b42318', ok: '#1f6b40', warn: '#7d5300',
  focus: '#0b5bd3', lineStrong: '#76839a', fill: '#1565d8', fillText: '#ffffff', pop: '#1565d8', popText: '#ffffff',
  sticker1: '#d6e8ff', sticker2: '#e7dcff', sticker3: '#ffd9d3', sticker4: '#d4f5d0', sticker5: '#ffe9b8', stickerText: '#1b2430',
  titleBg: '#e6e9ee', titleText: '#3a4552', titleActiveBg: '#dfe3e9', titleActiveText: '#1b2430',
  titleImage: 'linear-gradient(#f3f4f6, #c9ced6)',
  taskbarBg: '#f7f9fc', taskbarText: '#1b2430', desktopBg: '#dfe6ee', desktopDot: '#e9eef4', winBtnRadius: '50%',
  fontBody: nunito, fontMono: plexMono, fontDisplay: nunito, fontLabel: nunito, fontNumber: nunito,
  radius: '10px', radiusSm: '8px', radiusLg: '14px', lineWidth: '1px', controlLine: '1px',
  shadow: '0 12px 30px rgba(20,40,70,.22)', shadowSm: '0 1px 2px rgba(20,40,70,.14)',
  shadowHard: 'inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(20,40,70,.18)', shadowCard: '0 1px 3px rgba(20,40,70,.14)',
  shadowWindow: '0 18px 40px rgba(20,40,70,.28)', glow: 'none', tilt: '0deg',
};

const off = { scanlines: false, glow: false, crt: false };
export const themes: Record<ThemeName, Theme> = {
  webring: { name: 'webring', label: 'Webring', chrome: 'zine', scheme: 'light', tokens: webring, effects: off },
  'after-dark': { name: 'after-dark', label: 'After dark', chrome: 'zine', scheme: 'dark', tokens: afterDark, effects: off },
  terminal: { name: 'terminal', label: 'Terminal', chrome: 'terminal', scheme: 'dark', tokens: terminalTokens('amber'), effects: off },
  platinum: { name: 'platinum', label: 'Platinum', chrome: 'platinum', scheme: 'light', tokens: platinum, effects: off },
  aqua: { name: 'aqua', label: 'Aqua', chrome: 'aqua', scheme: 'light', tokens: aqua, effects: off },
};

const kebab = (k: string) => k.replace(/[A-Z0-9]+/g, (c) => `-${c.toLowerCase()}`);
const vars = (tokens: Tokens) => Object.entries(tokens).map(([k, v]) => `--${kebab(k)}:${v}`).join(';');

// The CSS for every theme and Terminal scheme. Applied with <html data-theme="…"> (and data-scheme="…" for Terminal).
export function themeCss(): string {
  const out: string[] = [];
  for (const t of Object.values(themes)) out.push(`:root[data-theme="${t.name}"]{color-scheme:${t.scheme};${vars(t.tokens)}}`);
  for (const s of TERMINAL_SCHEMES) {
    out.push(`:root[data-theme="terminal"][data-scheme="${s}"]{color-scheme:${TERMINAL_SCHEME_BASES[s].light ? 'light' : 'dark'};${vars(terminalTokens(s))}}`);
  }
  return out.join('\n');
}

export const isThemeName = (v: unknown): v is ThemeName => typeof v === 'string' && v in themes;
export const isTerminalScheme = (v: unknown): v is TerminalScheme => typeof v === 'string' && (TERMINAL_SCHEMES as readonly string[]).includes(v);

// The tokens actually in force for a theme (and, for Terminal, a scheme).
export const tokensFor = (theme: ThemeName, scheme?: TerminalScheme | null): Tokens =>
  theme === 'terminal' ? terminalTokens(scheme ?? 'amber') : themes[theme].tokens;

// Contrast ratio of two #rrggbb colours (WCAG 2.x). 4.5 is AA for body text; 7 is AAA.
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
