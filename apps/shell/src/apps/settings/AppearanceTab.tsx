import { useToast } from '../../components/feedback';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { THEMES, type Me, type ThemeName } from '@app/shared';
import { themes } from '@app/ui-themes';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { alertPrefs, askDesktopPermission, desktopSupported, playChime, saveAlertPrefs, unlockAudio, type AlertPrefs } from '../../alerts';
import { applyTheme, clockPref, effectPrefs, saveClockPref, saveEffectPrefs, saveWallpaperPref, wallpaperPref, WALLPAPERS } from '../../theme';

export function Appearance({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const current = (document.documentElement.dataset.theme as ThemeName | undefined) ?? me.theme ?? 'modern';
  const [theme, setTheme] = useState<ThemeName>(current);
  const [prefs, setPrefs] = useState(() => effectPrefs(theme));
  const [clock, setClock] = useState(clockPref);
  const [paper, setPaper] = useState(wallpaperPref);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (name: ThemeName) => api.patch<{ user: Me }>('/me', { theme: name }),
    onSuccess: ({ user }) => { qc.setQueryData(['me'], user); toast(t('settings.appearance.saved')); },
    onError: (e) => setError(errorText(e)),
  });

  const choose = (name: ThemeName) => {
    setTheme(name);
    setPrefs(effectPrefs(name));
    applyTheme(name); // takes effect at once; saving to the profile follows
    setError(null);
    save.mutate(name);
  };
  const toggle = (key: 'scanlines' | 'glow', on: boolean) => {
    const next = { ...prefs, [key]: on };
    setPrefs(next);
    saveEffectPrefs(theme, next);
    applyTheme(theme);
  };

  const effects = themes[theme].effects;
  return (
    <>
      <fieldset>
        <legend>{t('settings.appearance.theme')}</legend>
        <div className="theme-choices">
          {THEMES.map((name) => (
            <label key={name} className={`theme-choice${theme === name ? ' is-chosen' : ''}`}>
              <input type="radio" name="theme" value={name} checked={theme === name} onChange={() => choose(name)} />
              <span className="theme-swatch" aria-hidden="true">
                {[themes[name].tokens.bg, themes[name].tokens.accent, themes[name].tokens.titleActiveBg].map((c) => <span key={c} style={{ background: c }} />)}
              </span>
              <span>{t(`settings.theme.${name}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {(effects.scanlines || effects.glow) && (
        <fieldset>
          <legend>{t('settings.appearance.effects')}</legend>
          {effects.scanlines && <label className="check"><input type="checkbox" checked={prefs.scanlines} onChange={(e) => toggle('scanlines', e.target.checked)} />{t('settings.effects.scanlines')}</label>}
          {effects.glow && <label className="check"><input type="checkbox" checked={prefs.glow} onChange={(e) => toggle('glow', e.target.checked)} />{t('settings.effects.glow')}</label>}
        </fieldset>
      )}
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
