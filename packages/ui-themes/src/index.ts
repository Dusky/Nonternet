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
  | 'shadow' | 'shadowSm' | 'shadowHard' | 'shadowCard' | 'shadowWindow' | 'shadowPop' | 'glow' | 'tilt',
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
  // The dark version of a light theme: only the colours and shadows that change. A theme without one is the same in both modes
  // (After dark and Terminal are dark looks already).
  dark?: Partial<Tokens>;
  // Smaller shadows and thinner outlines under 700 px wide, so cards don't crowd a phone screen.
  phone?: Partial<Tokens>;
  phoneDark?: Partial<Tokens>;
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
  shadowWindow: offset(8, '#141414'), shadowPop: offset(5, '#ff4fa0'), glow: 'none', tilt: '-1deg',
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
  shadowWindow: offset(8, '#ffb43a'), shadowPop: offset(5, '#ff5fae'), glow: '0 0 6px rgba(255,180,58,.5)', tilt: '-1deg',
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
    shadow: 'none', shadowSm: 'none', shadowHard: 'none', shadowCard: 'none', shadowWindow: `0 0 0 1px ${s.border}`, shadowPop: `0 0 0 1px ${s.line}`,
    glow: s.light ? 'none' : `0 0 6px ${rgba(s.ink, 0.5)}`, tilt: '0deg',
  };
}

// The 16 colours the Terminal window (xterm.js) and BBS art use, per scheme. Phosphor schemes stay close to
// their one colour: red, green and yellow keep their meaning, the rest are shades of the phosphor.
export const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;
export type TerminalPalette = { background: string; foreground: string; cursor: string; selection: string; colours: string[] };
export function terminalPalette(scheme: TerminalScheme): TerminalPalette {
  const s = TERMINAL_SCHEME_BASES[scheme];
  const base = { background: s.bg, foreground: s.ink, cursor: s.accent, selection: s.border };
  if (scheme === 'ansi') {
    return { ...base, colours: [s.surface2, '#ff6b6b', '#5ee87a', '#ffe14d', '#7f9dff', '#ff7fe0', '#4fe0ff', '#c8c8e8',
      s.dim, '#ff9a9a', '#9dffb0', '#fff08a', '#b0c2ff', '#ffb0ee', '#a0f0ff', '#ffffff'] };
  }
  const dark = s.light ? s.ink : s.surface2;
  const white = s.light ? s.dim : s.ink;
  return { ...base, colours: [dark, s.danger, s.ok, s.warn, s.dim, s.dim, s.dim, white,
    s.dim, s.danger, s.ok, s.warn, s.accent, s.accent, s.accent, s.accent] };
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
  shadowWindow: `inset -1px -1px 0 #808080, inset 1px 1px 0 #ffffff, 3px 3px 0 rgba(0,0,0,.35)`, shadowPop: '3px 3px 0 rgba(0,0,0,.35)', glow: 'none', tilt: '0deg',
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
  shadowWindow: '0 18px 40px rgba(20,40,70,.28)', shadowPop: '0 12px 30px rgba(20,40,70,.22)', glow: 'none', tilt: '0deg',
};

// Dark modes (docs/10): each light theme keeps its shape, type and shadows' size, and gets its own dark colours.
// Webring at night: ink-violet paper, light outlines, the same pink for what is new.
const webringDark: Partial<Tokens> = {
  bg: '#16131f', surface: '#211c2e', surface2: '#2b2540', text: '#f4f0ff', muted: '#b9b0d6', border: '#4a4170',
  accent: '#b9a8ff', accentText: '#16131f', accentSoft: '#32295a', danger: '#ff8f80', ok: '#7fe0a3', warn: '#ffd166',
  focus: '#7fe3ff', lineStrong: '#f4f0ff', fill: '#ff6fb1', fillText: '#16131f', pop: '#ff6fb1', popText: '#16131f',
  sticker1: '#ffe14d', sticker2: '#8fe0ff', sticker3: '#ffa6cf', sticker4: '#c8ff6b', sticker5: '#c9b8ff', stickerText: '#16131f',
  titleBg: '#2b2540', titleText: '#b9b0d6', titleActiveBg: '#ff6fb1', titleActiveText: '#16131f',
  taskbarBg: '#0d0b14', taskbarText: '#f4f0ff', desktopBg: '#16131f', desktopDot: '#2e2748',
  shadow: offset(6, '#6b5bd6'), shadowSm: offset(3, '#6b5bd6'), shadowHard: offset(3, '#6b5bd6'), shadowCard: offset(5, '#6b5bd6'),
  shadowWindow: offset(8, '#6b5bd6'), shadowPop: offset(5, '#ff6fb1'),
};
// Platinum after hours: dark grey bevels (light edge up-left, dark edge down-right) on a deep teal desktop.
const bevelOutDark = 'inset -2px -2px 0 #1a1a1a, inset 2px 2px 0 #5c5c5c';
const platinumDark: Partial<Tokens> = {
  bg: '#2b2b2b', surface: '#363636', surface2: '#303030', text: '#f0f0f0', muted: '#c4c4c4', border: '#555555',
  accent: '#8fb0ff', accentText: '#0b1020', accentSoft: '#2f3a5c', danger: '#ff8f8f', ok: '#7fdc93', warn: '#ffd166',
  focus: '#8fb0ff', lineStrong: '#cfcfcf', fill: '#454545', fillText: '#f0f0f0', pop: '#8fb0ff', popText: '#0b1020',
  sticker1: '#454545', sticker2: '#454545', sticker3: '#454545', sticker4: '#454545', sticker5: '#454545', stickerText: '#f0f0f0',
  titleBg: '#2b2b2b', titleText: '#b8b8b8', titleActiveBg: '#2b2b2b', titleActiveText: '#ffffff',
  titleImage: 'repeating-linear-gradient(#2b2b2b 0 1px, #4a4a4a 1px 2px)',
  taskbarBg: '#3a3a3a', taskbarText: '#f0f0f0', desktopBg: '#1d4a4a', desktopDot: '#2a6060',
  shadow: '3px 3px 0 rgba(0,0,0,.6)', shadowSm: bevelOutDark, shadowHard: bevelOutDark, shadowCard: 'inset 2px 2px 0 #1a1a1a',
  shadowWindow: 'inset -1px -1px 0 #1a1a1a, inset 1px 1px 0 #5c5c5c, 3px 3px 0 rgba(0,0,0,.6)', shadowPop: '3px 3px 0 rgba(0,0,0,.6)',
};
// Aqua at night: slate glass, the same blue gel buttons.
const aquaDark: Partial<Tokens> = {
  bg: '#1c222b', surface: '#262d38', surface2: '#2d3541', text: '#e8eef7', muted: '#a9b6c8', border: '#3d4757',
  accent: '#6fa8ff', accentText: '#0a1220', accentSoft: '#243a5c', danger: '#ff8f80', ok: '#7fdc9a', warn: '#ffd166',
  focus: '#6fa8ff', lineStrong: '#7d8ca3', fill: '#2a6fe0', fillText: '#ffffff', pop: '#2a6fe0', popText: '#ffffff',
  sticker1: '#2b4a73', sticker2: '#41336b', sticker3: '#6b3a35', sticker4: '#2f5a37', sticker5: '#6b5320', stickerText: '#e8eef7',
  titleBg: '#2d3541', titleText: '#c3cddb', titleActiveBg: '#323b49', titleActiveText: '#ffffff', titleImage: 'linear-gradient(#3a4352, #2a313d)',
  taskbarBg: '#20262f', taskbarText: '#e8eef7', desktopBg: '#1c222b', desktopDot: '#262d38',
  shadow: '0 12px 30px rgba(0,0,0,.5)', shadowSm: '0 1px 2px rgba(0,0,0,.5)',
  shadowHard: 'inset 0 1px 0 rgba(255,255,255,.12), 0 1px 2px rgba(0,0,0,.5)', shadowCard: '0 1px 3px rgba(0,0,0,.5)',
  shadowWindow: '0 18px 40px rgba(0,0,0,.6)', shadowPop: '0 12px 30px rgba(0,0,0,.5)',
};

const off = { scanlines: false, glow: false, crt: false };
const zinePhone = (line: string, pop: string): Partial<Tokens> => ({
  lineWidth: '2px', shadow: offset(4, line), shadowCard: offset(3, line), shadowWindow: offset(4, line), shadowPop: offset(3, pop),
});
export const themes: Record<ThemeName, Theme> = {
  webring: { name: 'webring', label: 'Webring', chrome: 'zine', scheme: 'light', tokens: webring, dark: webringDark, phone: zinePhone('#141414', '#ff4fa0'), phoneDark: zinePhone('#6b5bd6', '#ff6fb1'), effects: off },
  'after-dark': { name: 'after-dark', label: 'After dark', chrome: 'zine', scheme: 'dark', tokens: afterDark, phone: zinePhone('#ffb43a', '#ff5fae'), effects: off },
  terminal: { name: 'terminal', label: 'Terminal', chrome: 'terminal', scheme: 'dark', tokens: terminalTokens('amber'), effects: off },
  platinum: { name: 'platinum', label: 'Platinum', chrome: 'platinum', scheme: 'light', tokens: platinum, dark: platinumDark, effects: off },
  aqua: { name: 'aqua', label: 'Aqua', chrome: 'aqua', scheme: 'light', tokens: aqua, dark: aquaDark, effects: off },
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
  // The dark version of a light theme applies when <html data-mode="dark">.
  for (const t of Object.values(themes)) if (t.dark) out.push(`:root[data-theme="${t.name}"][data-mode="dark"]{color-scheme:dark;${vars(t.dark as Tokens)}}`);
  const phone = Object.values(themes).filter((t) => t.phone).map((t) => `:root[data-theme="${t.name}"]{${vars(t.phone as Tokens)}}`);
  const phoneDark = Object.values(themes).filter((t) => t.phoneDark).map((t) => `:root[data-theme="${t.name}"][data-mode="dark"]{${vars(t.phoneDark as Tokens)}}`);
  if (phone.length) out.push(`@media (max-width: 699px){${phone.join('')}${phoneDark.join('')}}`);
  return out.join('\n');
}

export const isThemeName = (v: unknown): v is ThemeName => typeof v === 'string' && v in themes;
export const isTerminalScheme = (v: unknown): v is TerminalScheme => typeof v === 'string' && (TERMINAL_SCHEMES as readonly string[]).includes(v);

// The tokens actually in force for a theme (and, for Terminal, a scheme).
export const tokensFor = (theme: ThemeName, scheme?: TerminalScheme | null, mode: 'light' | 'dark' = 'light'): Tokens =>
  theme === 'terminal' ? terminalTokens(scheme ?? 'amber') : mode === 'dark' && themes[theme].dark ? { ...themes[theme].tokens, ...themes[theme].dark } : themes[theme].tokens;
// Whether a theme has both a light and a dark version (After dark and Terminal are dark looks of their own).
export const hasModes = (theme: ThemeName): boolean => Boolean(themes[theme].dark);

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
