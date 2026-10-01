import { useToast } from '../../components/feedback';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePasswordSchema, profileUpdateSchema, THEMES, type CharacterView, type Me, type ThemeName } from '@app/shared';
import { themes } from '@app/ui-themes';
import { api } from '../../api';
import { Alert, CopyButton, SideNav, TextField } from '../../components/ui';
import { errorText, useMe, useSite, useT } from '../../hooks';
import { matchRoute, useAppNav } from '../../nav';
import { YourData } from './YourData';
import { Blocks } from './Blocks';
import { OfflineMail, SshKeys, TerminalPassword } from './Terminal';
import { TotpSetup } from '../../pages/Setup2fa';
import { alertPrefs, askDesktopPermission, desktopSupported, playChime, saveAlertPrefs, unlockAudio, type AlertPrefs } from '../../alerts';
import { applyTheme, clockPref, effectPrefs, saveClockPref, saveEffectPrefs, saveWallpaperPref, wallpaperPref, WALLPAPERS } from '../../theme';

const ROUTES = ['profile', 'password', 'two-factor', 'terminal', 'data', 'blocked', 'appearance', 'notifications'] as const;

export default function SettingsApp() {
  const t = useT();
  const me = useMe().data;
  const site = useSite();
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  // Opening the app (or a screen that doesn't exist) lands on the first screen.
  useEffect(() => { if (!route) nav.go('profile', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return null;
  return (
    <SideNav label={t('app.settings')} groups={[{ items: [
      { to: 'profile', label: t('settings.tab.profile') },
      { to: 'appearance', label: t('settings.tab.appearance') },
      { to: 'notifications', label: t('settings.tab.notifications') },
      { to: 'password', label: t('settings.tab.password') },
      { to: 'two-factor', label: t('settings.tab.twofa') },
      { to: 'terminal', label: t('settings.tab.terminal') },
      ...(me.role !== 'guest' ? [{ to: 'blocked', label: t('settings.tab.blocked') }] : []),
      { to: 'data', label: t('settings.tab.data') },
    ] }]}>
      {route?.pattern === 'profile' && <><Profile me={me} />{site.services.mud && <FeaturedCharacter />}</>}
      {route?.pattern === 'password' && <Password />}
      {route?.pattern === 'two-factor' && <TwoFactor me={me} />}
      {route?.pattern === 'terminal' && <><TerminalPassword />{site.services.bbs && me.role !== 'guest' && <><SshKeys /><OfflineMail /></>}</>}
      {route?.pattern === 'data' && <YourData me={me} />}
      {route?.pattern === 'blocked' && <Blocks />}
      {route?.pattern === 'appearance' && <Appearance me={me} />}
      {route?.pattern === 'notifications' && <DeviceAlerts />}
    </SideNav>
  );
}

function Profile({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me.display_name ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.patch<{ user: Me }>('/me', body),
    onSuccess: ({ user }) => { qc.setQueryData(['me'], user); toast(t('settings.profile.saved')); },
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = profileUpdateSchema.safeParse({ display_name: displayName, bio });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    save.mutate(parsed.data);
  };
  return (
    <form onSubmit={submit} noValidate>
      <TextField label={t('field.displayName')} value={displayName} onChange={setDisplayName} maxLength={60} />
      <TextField label={t('field.bio')} value={bio} onChange={setBio} multiline maxLength={500} />
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={save.isPending}>{t('common.save')}</button>
    </form>
  );
}

// Which MUD character shows beside your name around the site (docs/09).
function FeaturedCharacter() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me', 'characters'], queryFn: () => api.get<{ characters: CharacterView[]; featured_character_id: string | null }>('/me/characters') });
  const save = useMutation({
    mutationFn: (id: string | null) => api.put('/me/featured-character', { character_id: id }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['me', 'characters'] }); void qc.invalidateQueries({ queryKey: ['profile'] }); },
  });
  if (!q.data) return null;
  return (
    <section className="panel" aria-labelledby="featured-h">
      <h2 id="featured-h">{t('settings.featured')}</h2>
      {q.data.characters.length === 0 ? <p className="muted">{t('settings.featuredEmpty')}</p> : (
        <div className="field">
          <label htmlFor="featured-char">{t('settings.featuredPick')}</label>
          <select id="featured-char" aria-describedby="featured-hint" value={q.data.featured_character_id ?? ''} disabled={save.isPending}
            onChange={(e) => save.mutate(e.target.value || null)}>
            <option value="">{t('settings.featuredNone')}</option>
            {q.data.characters.map((c) => <option key={c.id} value={c.id}>{t('people.characterLabel', { name: c.name, level: c.level })}</option>)}
          </select>
          <p className="hint" id="featured-hint">{t('settings.featuredHint')}</p>
          {save.isSuccess && <p role="status" className="hint">{t('settings.featuredSaved')}</p>}
          {save.isError && <Alert kind="error">{errorText(save.error)}</Alert>}
        </div>
      )}
    </section>
  );
}

function Password() {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => api.put('/me/password', { current_password: current, new_password: next }),
    onSuccess: () => { setCurrent(''); setNext(''); },
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = changePasswordSchema.safeParse({ current_password: current, new_password: next });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    change.mutate();
  };
  return (
    <form onSubmit={submit} noValidate>
      <TextField label={t('field.currentPassword')} value={current} onChange={setCurrent} type="password" autoComplete="current-password" required />
      <TextField label={t('field.newPassword')} value={next} onChange={setNext} type="password" hint={t('auth.signup.passwordHint')} autoComplete="new-password" required />
      {error && <Alert kind="error">{error}</Alert>}
      {change.isSuccess && !error && <Alert kind="success">{t('settings.password.changed')}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={change.isPending}>{t('settings.tab.password')}</button>
    </form>
  );
}

function TwoFactor({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const regen = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] }>('/me/totp/recovery-codes', { code }),
    onSuccess: (r) => { setCodes(r.recovery_codes); setCode(''); void qc.invalidateQueries({ queryKey: ['me'] }); },
    onError: (e) => setError(errorText(e)),
  });

  if (!me.totp_enabled) {
    return (
      <>
        <p>{t('settings.twofa.off')}</p>
        <TotpSetup onDone={() => void qc.invalidateQueries({ queryKey: ['me'] })} />
      </>
    );
  }
  return (
    <>
      <p>{t('settings.twofa.on')}</p>
      <p>{t('settings.twofa.codesLeft', { count: me.recovery_codes_remaining })}</p>
      {codes ? (
        <section aria-labelledby="new-codes">
          <h2 id="new-codes">{t('twofa.codes.title')}</h2>
          <p>{t('twofa.codes.body')}</p>
          <ul className="codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          <CopyButton text={codes.join('\n')} />
        </section>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setError(null); regen.mutate(); }}>
          <TextField label={t('field.code')} value={code} onChange={setCode} hint={t('settings.twofa.regenHint')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn" type="submit" disabled={regen.isPending || code.length !== 6}>{t('settings.twofa.regen')}</button>
        </form>
      )}
    </>
  );
}

function Appearance({ me }: { me: Me }) {
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
function DeviceAlerts() {
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
