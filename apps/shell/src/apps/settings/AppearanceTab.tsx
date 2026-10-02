import { useToast } from '../../components/feedback';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TERMINAL_SCHEMES, THEMES, type Me, type TerminalScheme, type ThemeName } from '@app/shared';
import { TERMINAL_SCHEME_BASES, tokensFor } from '@app/ui-themes';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { alertPrefs, askDesktopPermission, desktopSupported, playChime, saveAlertPrefs, unlockAudio, type AlertPrefs } from '../../alerts';
import { applyTheme, BOX_STYLES, boxStylePref, clockPref, DEFAULT_THEME, DENSITIES, densityPref, effectPrefs, saveBoxStylePref, saveClockPref, saveDensityPref, saveEffectPrefs, saveWallpaperPref, wallpaperPref, WALLPAPERS, type EffectPrefs } from '../../theme';

export function Appearance({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const root = document.documentElement.dataset;
  const [theme, setTheme] = useState<ThemeName>((root.theme as ThemeName | undefined) ?? me.theme ?? DEFAULT_THEME);
  const [scheme, setScheme] = useState<TerminalScheme>((root.scheme as TerminalScheme | undefined) ?? me.theme_variant ?? 'amber');
  const [fx, setFx] = useState(effectPrefs);
  const [density, setDensity] = useState(densityPref);
  const [boxes, setBoxes] = useState(boxStylePref);
  const [clock, setClock] = useState(clockPref);
  const [paper, setPaper] = useState(wallpaperPref);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { theme: ThemeName; theme_variant: TerminalScheme | null }) => api.patch<{ user: Me }>('/me', body),
    onSuccess: ({ user }) => { qc.setQueryData(['me'], user); toast(t('settings.appearance.saved')); },
    onError: (e) => setError(errorText(e)),
  });

  // Takes effect at once; saving to the profile follows, so it sticks on other devices too.
  const choose = (name: ThemeName, nextScheme: TerminalScheme = scheme) => {
    setTheme(name);
    setScheme(nextScheme);
    applyTheme(name, { scheme: name === 'terminal' ? nextScheme : null });
    setError(null);
    save.mutate({ theme: name, theme_variant: name === 'terminal' ? nextScheme : null });
  };
  const toggle = (key: keyof EffectPrefs, on: boolean) => {
    const next = { ...fx, [key]: on };
    setFx(next);
    saveEffectPrefs(next);
  };

  return (
    <>
      <fieldset>
        <legend>{t('settings.appearance.theme')}</legend>
        <div className="theme-cards">
          {THEMES.map((name) => {
            const k = tokensFor(name, name === 'terminal' ? scheme : null);
            return (
              <label key={name} className={`theme-card${theme === name ? ' is-chosen' : ''}`}>
                <span className="theme-mini" aria-hidden="true" style={{ background: k.bg, fontFamily: k.fontDisplay }}>
                  <span className="theme-mini-hello" style={{ color: name === 'webring' ? k.text : k.accent }}>{t('settings.appearance.preview')}</span>
                  <span className="theme-mini-row">
                    <span style={{ background: k.fill, border: `2px solid ${k.lineStrong}`, boxShadow: k.shadowHard, borderRadius: k.radiusSm }} />
                    <span style={{ background: k.surface, border: `2px solid ${k.lineStrong}`, boxShadow: k.shadowHard, borderRadius: k.radiusSm }} />
                  </span>
                  <span className="theme-mini-card" style={{ background: k.surface, border: `2px solid ${k.lineStrong}`, boxShadow: k.shadowCard, borderRadius: k.radius }} />
                </span>
                <span className="theme-card-label">
                  <input type="radio" name="theme" value={name} checked={theme === name} onChange={() => choose(name)} />
                  <span><strong>{t(`settings.theme.${name}` as StringKey)}</strong><br /><span className="hint">{t(`settings.theme.${name}.hint` as StringKey)}</span></span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {theme === 'terminal' && (
        <>
          <fieldset>
            <legend>{t('settings.appearance.scheme')}</legend>
            <div className="scheme-choices">
              {TERMINAL_SCHEMES.map((s) => {
                const b = TERMINAL_SCHEME_BASES[s];
                return (
                  <label key={s} className={`scheme-choice${scheme === s ? ' is-chosen' : ''}`}>
                    <input type="radio" name="scheme" value={s} checked={scheme === s} onChange={() => choose('terminal', s)} />
                    <span className="scheme-swatch" aria-hidden="true" style={{ background: b.bg, color: b.ink, borderColor: b.line }}>A_<span style={{ color: b.accent }}>█</span></span>
                    <span>{t(`settings.scheme.${s}` as StringKey)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t('settings.appearance.boxes')}</legend>
            <div className="choice-row">
              {BOX_STYLES.map((b) => (
                <label key={b} className="check"><input type="radio" name="boxes" value={b} checked={boxes === b} onChange={() => { setBoxes(b); saveBoxStylePref(b); }} />{t(`settings.boxes.${b}` as StringKey)}</label>
              ))}
            </div>
            <p className="hint">{t('settings.appearance.thisDevice')}</p>
          </fieldset>
        </>
      )}
      <fieldset>
        <legend>{t('settings.appearance.effects')}</legend>
        {(['scanlines', 'glow', 'crt'] as const).map((key) => (
          <label key={key} className="check">
            <input type="checkbox" checked={fx[key]} onChange={(e) => toggle(key, e.target.checked)} />
            <span><strong>{t(`settings.effects.${key}` as StringKey)}</strong> <span className="hint">{t(`settings.effects.${key}.hint` as StringKey)}</span></span>
          </label>
        ))}
        <p className="hint">{t('settings.appearance.effectsNote')} {t('settings.appearance.thisDevice')}</p>
      </fieldset>
      <fieldset>
        <legend>{t('settings.appearance.density')}</legend>
        <div className="choice-row">
          {DENSITIES.map((d) => (
            <label key={d} className="check"><input type="radio" name="density" value={d} checked={density === d} onChange={() => { setDensity(d); saveDensityPref(d); }} />{t(`settings.density.${d}` as StringKey)}</label>
          ))}
        </div>
        <p className="hint">{t('settings.appearance.thisDevice')}</p>
      </fieldset>
      <fieldset>
        <legend>{t('settings.appearance.wallpaper')}</legend>
        <div className="theme-choices">
          {WALLPAPERS.map((w) => (
            <label key={w} className={`theme-choice${paper === w ? ' is-chosen' : ''}`}>
              <input type="radio" name="wallpaper" value={w} checked={paper === w} onChange={() => { setPaper(w); saveWallpaperPref(w); }} />
              <span className={`theme-swatch wallpaper-swatch wp-${w}`} aria-hidden="true" />
              <span>{t(`settings.wallpaper.${w}`)}</span>
            </label>
          ))}
        </div>
        <p className="hint">{t('settings.appearance.thisDevice')}</p>
      </fieldset>
      <fieldset>
        <legend>{t('settings.appearance.taskbar')}</legend>
        <label className="check"><input type="checkbox" checked={clock} onChange={(e) => { setClock(e.target.checked); saveClockPref(e.target.checked); }} />{t('settings.appearance.clock')}</label>
        <p className="hint">{t('settings.appearance.thisDevice')}</p>
      </fieldset>
      {error && <Alert kind="error">{error}</Alert>}
    </>
  );
}

// Alerts on this device (M9-B): a desktop notification and a chime when something arrives and the tab is in the
// background. Off until turned on; the browser asks for permission when notifications are first switched on.
export function DeviceAlerts() {
  const t = useT();
  const [prefs, setPrefs] = useState(alertPrefs);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (desktopSupported() ? Notification.permission : 'unsupported'));
  const toast = useToast();
  const save = (next: AlertPrefs) => { setPrefs(next); saveAlertPrefs(next); };
  const turnOnDesktop = async (on: boolean) => {
    if (!on) return save({ ...prefs, desktop: false });
    const p = await askDesktopPermission();
    setPermission(p);
    save({ ...prefs, desktop: p === 'granted' });
  };
  return (
    <section aria-labelledby="alerts-h">
      <h2 id="alerts-h">{t('settings.alerts.title')}</h2>
      <p className="hint">{t('settings.alerts.intro')}</p>
      <fieldset>
        <legend>{t('settings.alerts.device')}</legend>
        <label className="check">
          <input type="checkbox" checked={prefs.desktop} disabled={permission === 'unsupported'} onChange={(e) => void turnOnDesktop(e.target.checked)} />
          {t('settings.alerts.desktop')}
        </label>
        {permission === 'unsupported' && <p className="hint">{t('settings.alerts.unsupported')}</p>}
        {permission === 'denied' && <p className="field-error">{t('settings.alerts.denied')}</p>}
        <label className="check">
          <input type="checkbox" checked={prefs.sound} onChange={(e) => { unlockAudio(); save({ ...prefs, sound: e.target.checked }); if (e.target.checked) playChime(); }} />
          {t('settings.alerts.sound')}
        </label>
        <p className="hint">{t('settings.appearance.thisDevice')}</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => { unlockAudio(); if (prefs.sound) playChime(); toast(t('settings.alerts.tested')); }}>{t('settings.alerts.test')}</button>
        </div>
      </fieldset>
    </section>
  );
}
