import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changePasswordSchema, profileUpdateSchema, THEMES, type Me, type ThemeName } from '@app/shared';
import { themes } from '@app/ui-themes';
import { api } from '../../api';
import { Alert, CopyButton, TextField } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { AppNavLink, matchRoute, useAppNav } from '../../nav';
import { TotpSetup } from '../../pages/Setup2fa';
import { applyTheme, effectPrefs, saveEffectPrefs } from '../../theme';

const ROUTES = ['profile', 'password', 'two-factor', 'appearance'] as const;

export default function SettingsApp() {
  const t = useT();
  const me = useMe().data;
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  // Opening the app (or a screen that doesn't exist) lands on the first screen.
  useEffect(() => { if (!route) nav.go('profile', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return null;
  return (
    <div className="app">
      <nav className="tabs" aria-label={t('app.settings')}>
        <AppNavLink to="profile">{t('settings.tab.profile')}</AppNavLink>
        <AppNavLink to="password">{t('settings.tab.password')}</AppNavLink>
        <AppNavLink to="two-factor">{t('settings.tab.twofa')}</AppNavLink>
        <AppNavLink to="appearance">{t('settings.tab.appearance')}</AppNavLink>
      </nav>
      <div className="app-content">
        {route?.pattern === 'profile' && <Profile me={me} />}
        {route?.pattern === 'password' && <Password />}
        {route?.pattern === 'two-factor' && <TwoFactor me={me} />}
        {route?.pattern === 'appearance' && <Appearance me={me} />}
      </div>
    </div>
  );
}

function Profile({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me.display_name ?? '');
  const [bio, setBio] = useState(me.bio ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.patch<{ user: Me }>('/me', body),
    onSuccess: ({ user }) => qc.setQueryData(['me'], user),
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
      {save.isSuccess && !error && <Alert kind="success">{t('settings.profile.saved')}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={save.isPending}>{t('common.save')}</button>
    </form>
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
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (name: ThemeName) => api.patch<{ user: Me }>('/me', { theme: name }),
    onSuccess: ({ user }) => qc.setQueryData(['me'], user),
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
        {THEMES.map((name) => (
          <label key={name} className="check">
            <input type="radio" name="theme" value={name} checked={theme === name} onChange={() => choose(name)} />
            {t(`settings.theme.${name}`)}
          </label>
        ))}
      </fieldset>
      {(effects.scanlines || effects.glow) && (
        <fieldset>
          <legend>{t('settings.appearance.effects')}</legend>
          {effects.scanlines && <label className="check"><input type="checkbox" checked={prefs.scanlines} onChange={(e) => toggle('scanlines', e.target.checked)} />{t('settings.effects.scanlines')}</label>}
          {effects.glow && <label className="check"><input type="checkbox" checked={prefs.glow} onChange={(e) => toggle('glow', e.target.checked)} />{t('settings.effects.glow')}</label>}
        </fieldset>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {save.isSuccess && !error && <Alert kind="success">{t('settings.appearance.saved')}</Alert>}
    </>
  );
}
