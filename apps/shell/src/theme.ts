import { isThemeName, themeCss, themes } from '@app/ui-themes';
import type { ThemeName } from '@app/shared';

export const DEFAULT_THEME: ThemeName = 'modern';
const THEME_KEY = 'ui:theme';
const EFFECTS_KEY = 'ui:effects';

export interface EffectPrefs { scanlines: boolean; glow: boolean }

const store = () => {
  try { return window.localStorage; } catch { return null; }
};

export function installThemeCss(): void {
  if (document.getElementById('theme-css')) return;
  const el = document.createElement('style');
  el.id = 'theme-css';
  el.textContent = themeCss();
  document.head.appendChild(el);
}

export function rememberedTheme(): ThemeName {
  const v = store()?.getItem(THEME_KEY);
  return isThemeName(v) ? v : DEFAULT_THEME;
}

// Whether this browser has a theme of its own (picked here, or from the person's profile). If not,
// the site's default (an admin setting) is used once the site config has loaded.
export function hasRememberedTheme(): boolean {
  try { return isThemeName(store()?.getItem(THEME_KEY)); } catch { return false; }
}

// Effects (scanlines, glow) are switched on by the theme unless the person turned them off, and
// they never run for someone who asked the browser for reduced motion.
export function effectPrefs(theme: ThemeName): EffectPrefs {
  try {
    const raw = store()?.getItem(`${EFFECTS_KEY}:${theme}`);
    if (raw) return { ...themes[theme].effects, ...(JSON.parse(raw) as Partial<EffectPrefs>) };
  } catch { /* fall back to the theme's own defaults */ }
  return { ...themes[theme].effects };
}

export function saveEffectPrefs(theme: ThemeName, prefs: EffectPrefs): void {
  try { store()?.setItem(`${EFFECTS_KEY}:${theme}`, JSON.stringify(prefs)); } catch { /* a convenience only */ }
}

export function applyTheme(theme: ThemeName, opts: { remember?: boolean } = {}): void {
  const root = document.documentElement;
  const prefs = effectPrefs(theme);
  root.dataset.theme = theme;
  root.dataset.scanlines = prefs.scanlines ? 'on' : 'off';
  root.dataset.glow = prefs.glow ? 'on' : 'off';
  root.dataset.wallpaper = wallpaperPref();
  if (opts.remember === false) return;
  try { store()?.setItem(THEME_KEY, theme); } catch { /* a convenience only */ }
}

// The taskbar clock: on unless the person switched it off on this device.
const CLOCK_KEY = 'ui:clock';
export function clockPref(): boolean {
  try { return store()?.getItem(CLOCK_KEY) !== 'off'; } catch { return true; }
}
export function saveClockPref(on: boolean): void {
  try { store()?.setItem(CLOCK_KEY, on ? 'on' : 'off'); } catch { /* a convenience only */ }
  window.dispatchEvent(new Event('ui:clock'));
}

// The desktop wallpaper: one of a few patterns, kept on this device (like the clock).
export const WALLPAPERS = ['dots', 'grid', 'stripes', 'plain'] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];
const WALLPAPER_KEY = 'ui:wallpaper';
export function wallpaperPref(): Wallpaper {
  try { const v = store()?.getItem(WALLPAPER_KEY); return (WALLPAPERS as readonly string[]).includes(v ?? '') ? (v as Wallpaper) : 'dots'; } catch { return 'dots'; }
}
export function saveWallpaperPref(w: Wallpaper): void {
  try { store()?.setItem(WALLPAPER_KEY, w); } catch { /* a convenience only */ }
  document.documentElement.dataset.wallpaper = w;
}
