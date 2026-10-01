import type { ThemeName } from '@app/shared';

// Themes are token sets (docs/10). They style the chrome; the words in the interface follow the
// plain voice in every theme. Every text/background pair below is checked against WCAG AA in the
// tests, and the retro themes are held to a higher bar than the modern one.

export type Tokens = Record<
  | 'bg' | 'surface' | 'surface2' | 'text' | 'muted' | 'border' | 'accent' | 'accentText'
  | 'accentSoft' | 'danger' | 'ok' | 'warn' | 'focus' | 'lineStrong'
  | 'titleBg' | 'titleText' | 'titleActiveBg' | 'titleActiveText' | 'taskbarBg' | 'taskbarText' | 'desktopBg' | 'desktopDot'
  | 'fontBody' | 'fontMono' | 'fontDisplay' | 'radius' | 'radiusSm' | 'radiusLg' | 'shadow' | 'shadowSm' | 'glow',
  string
>;

export interface Theme {
  name: ThemeName;
  label: string;
  tokens: Tokens;
  // Modern also has a dark variant, applied when the browser asks for dark.
  dark?: Tokens;
  // Effects a theme offers. Each can be switched off individually.
  effects: { scanlines: boolean; glow: boolean };
}

const systemSans = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
const systemMono = `ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace`;

// Modern: warm paper and ink, a blue accent, monospace for the site name, headings and numbers so it
// keeps a little of the terminal about it without changing how anything reads.
const modernLight: Tokens = {
  bg: '#f4f2ec', surface: '#fffefb', surface2: '#efece4', text: '#1c1b18', muted: '#585549', border: '#d6d1c4',
  accent: '#2b4fd6', accentText: '#ffffff', accentSoft: '#e7ecfc', danger: '#b42318', ok: '#1f6b40', warn: '#7d5300',
  focus: '#2b4fd6', lineStrong: '#a49d8b',
  titleBg: '#ebe7dc', titleText: '#3d3b33', titleActiveBg: '#1c1b18', titleActiveText: '#fffefb',
  taskbarBg: '#fffefb', taskbarText: '#1c1b18', desktopBg: '#ece9e0', desktopDot: '#d3cdbd',
  fontBody: systemSans, fontMono: systemMono, fontDisplay: systemMono,
  radius: '10px', radiusSm: '6px', radiusLg: '16px',
  shadow: '0 1px 2px rgba(28,27,24,.06), 0 12px 32px rgba(28,27,24,.14)', shadowSm: '0 1px 2px rgba(28,27,24,.08)', glow: 'none',
};

const modernDark: Tokens = {
  ...modernLight,
  bg: '#121316', surface: '#1b1c21', surface2: '#25272e', text: '#ecebe6', muted: '#a9a79f', border: '#363841',
  accent: '#8ea6ff', accentText: '#0d1020', accentSoft: '#232b48', danger: '#ff8b7d', ok: '#7fd19c', warn: '#f0c060',
  focus: '#a9bbff', lineStrong: '#5a5d68',
  titleBg: '#23252c', titleText: '#c9c7c0', titleActiveBg: '#ecebe6', titleActiveText: '#121316',
  taskbarBg: '#1b1c21', taskbarText: '#ecebe6', desktopBg: '#16171b', desktopDot: '#2b2d35',
  shadow: '0 1px 2px rgba(0,0,0,.3), 0 12px 32px rgba(0,0,0,.55)', shadowSm: '0 1px 2px rgba(0,0,0,.4)',
};

const amber: Tokens = {
  bg: '#120b00', surface: '#1a1000', surface2: '#241600', text: '#ffb000', muted: '#e09a00', border: '#7a5200',
  accent: '#ffb000', accentText: '#120b00', accentSoft: '#2e1d00', danger: '#ff8a6b', ok: '#8fe36b', warn: '#ffd166',
  focus: '#ffd166', lineStrong: '#a87100',
  titleBg: '#3a2500', titleText: '#ffb000', titleActiveBg: '#ffb000', titleActiveText: '#120b00',
  taskbarBg: '#1a1000', taskbarText: '#ffb000', desktopBg: '#120b00', desktopDot: '#2e1d00',
  fontBody: systemMono, fontMono: systemMono, fontDisplay: systemMono,
  radius: '0px', radiusSm: '0px', radiusLg: '0px', shadow: '0 0 0 1px #7a5200', shadowSm: 'none', glow: '0 0 6px rgba(255,176,0,.55)',
};

export const themes: Record<ThemeName, Theme> = {
  modern: { name: 'modern', label: 'Modern', tokens: modernLight, dark: modernDark, effects: { scanlines: false, glow: false } },
  amber: { name: 'amber', label: 'Amber screen', tokens: amber, effects: { scanlines: true, glow: true } },
};

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const block = (selector: string, tokens: Tokens, colorScheme: 'light' | 'dark') =>
  `${selector}{color-scheme:${colorScheme};${Object.entries(tokens).map(([k, v]) => `--${kebab(k)}:${v}`).join(';')}}`;

// The CSS for every theme. Applied with <html data-theme="modern|amber">.
export function themeCss(): string {
  const out: string[] = [];
  for (const t of Object.values(themes)) {
    const dark = t.name === 'amber';
    out.push(block(`:root[data-theme="${t.name}"]`, t.tokens, dark ? 'dark' : 'light'));
    if (t.dark) out.push(`@media (prefers-color-scheme: dark){${block(`:root[data-theme="${t.name}"]`, t.dark, 'dark')}}`);
  }
  return out.join('\n');
}

export const isThemeName = (v: unknown): v is ThemeName => typeof v === 'string' && v in themes;

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
