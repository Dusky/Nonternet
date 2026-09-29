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

export function applyTheme(theme: ThemeName): void {
  const root = document.documentElement;
  const prefs = effectPrefs(theme);
  root.dataset.theme = theme;
  root.dataset.scanlines = prefs.scanlines ? 'on' : 'off';
  root.dataset.glow = prefs.glow ? 'on' : 'off';
  try { store()?.setItem(THEME_KEY, theme); } catch { /* a convenience only */ }
}
