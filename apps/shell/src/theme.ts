import { isTerminalScheme, isThemeName, themeCss, themes } from '@app/ui-themes';
import { DEFAULT_THEME_NAME, LEGACY_THEMES, type TerminalScheme, type ThemeName } from '@app/shared';

export const DEFAULT_THEME: ThemeName = DEFAULT_THEME_NAME;
const THEME_KEY = 'ui:theme';
const SCHEME_KEY = 'ui:scheme';
const EFFECTS_KEY = 'ui:effects';
const DENSITY_KEY = 'ui:density';
const BOXES_KEY = 'ui:boxes';

export interface EffectPrefs { scanlines: boolean; glow: boolean; crt: boolean }
export const DENSITIES = ['comfy', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];
// How the Terminal theme draws its boxes. "double" also brings the pixel heading font (the BBS look).
export const BOX_STYLES = ['single', 'double', 'heavy', 'none'] as const;
export type BoxStyle = (typeof BOX_STYLES)[number];

const store = () => {
  try { return window.localStorage; } catch { return null; }
};
const read = (key: string) => { try { return store()?.getItem(key) ?? null; } catch { return null; } };
const write = (key: string, value: string) => { try { store()?.setItem(key, value); } catch { /* a convenience only */ } };

export function installThemeCss(): void {
  if (document.getElementById('theme-css')) return;
  const el = document.createElement('style');
  el.id = 'theme-css';
  el.textContent = themeCss();
  document.head.appendChild(el);
}

// A theme saved in this browser before the restyle still works: it means its successor.
const upgrade = (v: string | null): string | null => (v && v in LEGACY_THEMES ? LEGACY_THEMES[v]! : v);

export function rememberedTheme(): ThemeName {
  const v = upgrade(read(THEME_KEY));
  return isThemeName(v) ? v : DEFAULT_THEME;
}
export function rememberedScheme(): TerminalScheme | null {
  const v = read(SCHEME_KEY);
  return isTerminalScheme(v) ? v : null;
}

// Whether this browser has a theme of its own (picked here, or from the person's profile). If not,
// the site's default (an admin setting) is used once the site config has loaded.
export function hasRememberedTheme(): boolean {
  return isThemeName(upgrade(read(THEME_KEY)));
}

// Effects (scanlines, glow, CRT corners) are off until switched on here, on this device. The stylesheet
// also turns them off whenever the browser asks for reduced motion or more contrast.
export function effectPrefs(): EffectPrefs {
  try {
    const raw = read(EFFECTS_KEY);
    if (raw) return { scanlines: false, glow: false, crt: false, ...(JSON.parse(raw) as Partial<EffectPrefs>) };
  } catch { /* fall back to all off */ }
  return { scanlines: false, glow: false, crt: false };
}
export function saveEffectPrefs(prefs: EffectPrefs): void {
  write(EFFECTS_KEY, JSON.stringify(prefs));
  applyModifiers();
}

export function densityPref(): Density {
  const v = read(DENSITY_KEY);
  return (DENSITIES as readonly string[]).includes(v ?? '') ? (v as Density) : 'comfy';
}
export function saveDensityPref(d: Density): void { write(DENSITY_KEY, d); applyModifiers(); }

export function boxStylePref(): BoxStyle {
  const v = read(BOXES_KEY);
  return (BOX_STYLES as readonly string[]).includes(v ?? '') ? (v as BoxStyle) : 'single';
}
export function saveBoxStylePref(b: BoxStyle): void { write(BOXES_KEY, b); applyModifiers(); }

// Everything on <html> that is not the theme itself: effects, density, box style, wallpaper.
function applyModifiers(): void {
  const root = document.documentElement;
  const fx = effectPrefs();
  root.dataset.scanlines = fx.scanlines ? 'on' : 'off';
  root.dataset.glow = fx.glow ? 'on' : 'off';
  root.dataset.crt = fx.crt ? 'on' : 'off';
  root.dataset.density = densityPref();
  root.dataset.boxes = boxStylePref();
  root.dataset.wallpaper = wallpaperPref();
}

export function applyTheme(theme: ThemeName, opts: { remember?: boolean; scheme?: TerminalScheme | null } = {}): void {
  const root = document.documentElement;
  const scheme = opts.scheme === undefined ? rememberedScheme() : opts.scheme;
  root.dataset.theme = theme;
  root.dataset.chrome = themes[theme].chrome;
  if (theme === 'terminal') root.dataset.scheme = scheme ?? 'amber';
  else delete root.dataset.scheme;
  applyModifiers();
  if (opts.remember !== false) {
    write(THEME_KEY, theme);
    if (opts.scheme !== undefined) write(SCHEME_KEY, opts.scheme ?? 'amber');
  }
  window.dispatchEvent(new Event('ui:theme'));
}

// The Terminal window and the MUD use your Terminal screen colour in every theme.
export function terminalScheme(): TerminalScheme {
  const shown = document.documentElement.dataset.scheme;
  return isTerminalScheme(shown) ? shown : rememberedScheme() ?? 'amber';
}

// The taskbar clock: on unless the person switched it off on this device.
const CLOCK_KEY = 'ui:clock';
export function clockPref(): boolean {
  return read(CLOCK_KEY) !== 'off';
}
export function saveClockPref(on: boolean): void {
  write(CLOCK_KEY, on ? 'on' : 'off');
  window.dispatchEvent(new Event('ui:clock'));
}

// The desktop wallpaper: one of a few patterns, kept on this device (like the clock).
export const WALLPAPERS = ['dots', 'grid', 'stripes', 'plain'] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];
const WALLPAPER_KEY = 'ui:wallpaper';
export function wallpaperPref(): Wallpaper {
  const v = read(WALLPAPER_KEY);
  return (WALLPAPERS as readonly string[]).includes(v ?? '') ? (v as Wallpaper) : 'dots';
}
export function saveWallpaperPref(w: Wallpaper): void {
  write(WALLPAPER_KEY, w);
  document.documentElement.dataset.wallpaper = w;
}
