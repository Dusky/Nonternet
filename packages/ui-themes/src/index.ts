import type { ThemeName } from '@app/shared';

// Themes are token sets (docs/10). They style the chrome; the words in the interface follow the
// plain voice in every theme. Every text/background pair below is checked against WCAG AA in the
// tests, and the retro themes are held to a higher bar than the modern one.

export type Tokens = Record<
  | 'bg' | 'surface' | 'surface2' | 'text' | 'muted' | 'border' | 'accent' | 'accentText'
  | 'danger' | 'ok' | 'focus' | 'titleBg' | 'titleText' | 'taskbarBg' | 'taskbarText'
  | 'fontBody' | 'fontMono' | 'radius' | 'shadow' | 'glow',
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

const modernLight: Tokens = {
  bg: '#f3f4f7', surface: '#ffffff', surface2: '#eceef3', text: '#16181d', muted: '#565b66', border: '#c9cdd6',
  accent: '#1f5fd6', accentText: '#ffffff', danger: '#b3261e', ok: '#1a6b3a', focus: '#1f5fd6',
  titleBg: '#dfe3ec', titleText: '#16181d', taskbarBg: '#ffffff', taskbarText: '#16181d',
  fontBody: systemSans, fontMono: systemMono, radius: '8px', shadow: '0 8px 24px rgba(20,24,35,.18)', glow: 'none',
};

const modernDark: Tokens = {
  ...modernLight,
  bg: '#14161b', surface: '#1d2027', surface2: '#262a33', text: '#eceef3', muted: '#a4a9b5', border: '#3a3f4b',
  accent: '#6ea0ff', accentText: '#0b1020', danger: '#ff8a80', ok: '#7fd39b', focus: '#8fb4ff',
  titleBg: '#2b303b', titleText: '#eceef3', taskbarBg: '#1d2027', taskbarText: '#eceef3',
  shadow: '0 8px 24px rgba(0,0,0,.5)',
};

const amber: Tokens = {
  bg: '#120b00', surface: '#1a1000', surface2: '#241600', text: '#ffb000', muted: '#e09a00', border: '#7a5200',
  accent: '#ffb000', accentText: '#120b00', danger: '#ff8a6b', ok: '#8fe36b', focus: '#ffd166',
  titleBg: '#ffb000', titleText: '#120b00', taskbarBg: '#1a1000', taskbarText: '#ffb000',
  fontBody: systemMono, fontMono: systemMono, radius: '0px', shadow: '0 0 0 1px #7a5200', glow: '0 0 6px rgba(255,176,0,.55)',
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
