import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WALLPAPER_FITS, WALLPAPER_MAX_BYTES, WALLPAPER_PATTERNS, WALLPAPER_PRESETS, type WallpaperFit, type WallpaperSettings } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { errorText, useT } from '../../hooks';
import { applyWallpaperSettings, useWallpaper } from '../../wallpaper';
import { Section } from './Section';

// The desktop wallpaper (docs/10): a pattern, one of the site's pictures, or your own (uploaded, or copied once from
// a web address). Kept on your account; your own picture is shown only to you.

export function WallpaperPicker() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useWallpaper();
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<{ choice: string; fit: WallpaperFit } | null>(null); // shown before the account answers
  const [error, setError] = useState<string | null>(null);
  const done = (w: WallpaperSettings) => { qc.setQueryData(['wallpaper'], w); applyWallpaperSettings(w); setError(null); };
  const choose = useMutation({
    mutationFn: (b: { choice: string; fit: WallpaperFit }) => api.put<WallpaperSettings>('/me/wallpaper', b),
    // Shows at once; put back if the account refuses it.
    onMutate: (b) => {
      const before = qc.getQueryData<WallpaperSettings>(['wallpaper']);
      if (before) { const next = { ...before, ...b }; qc.setQueryData(['wallpaper'], next); applyWallpaperSettings(next); }
      return { before };
    },
    onSettled: () => setPicked(null),
    onSuccess: done,
    onError: (e, _b, c) => { setError(errorText(e)); if (c?.before) { qc.setQueryData(['wallpaper'], c.before); applyWallpaperSettings(c.before); } },
  });
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<WallpaperSettings>('/me/wallpaper/image', f, 'PUT'),
    onSuccess: (w) => { done(w); toast(t('settings.wallpaper.saved')); },
    onError: (e) => setError(errorText(e)),
  });
  const fetchUrl = useMutation({
    mutationFn: (u: string) => api.post<WallpaperSettings>('/me/wallpaper/from-url', { url: u }),
    onSuccess: (w) => { done(w); setUrl(''); toast(t('settings.wallpaper.saved')); },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del('/me/wallpaper/image'),
    onSuccess: async () => { const w = await api.get<WallpaperSettings>('/me/wallpaper'); done(w); toast(t('settings.wallpaper.removed')); },
  });
  const w = q.data && picked ? { ...q.data, ...picked } : q.data;
  if (!w) return null;
  const set = (b: { choice: string; fit: WallpaperFit }) => { setPicked(b); choose.mutate(b); };
  const pick = (choice: string) => set({ choice, fit: w.fit });
  const option = (choice: string, label: string, swatch: React.ReactNode) => (
    <label key={choice} className={`theme-choice${w.choice === choice ? ' is-chosen' : ''}`}>
      <input type="radio" name="wallpaper" value={choice} checked={w.choice === choice} onChange={() => pick(choice)} />
      {swatch}
      <span>{label}</span>
    </label>
  );
  const busy = upload.isPending || fetchUrl.isPending;
  return (
    <Section id="look-wallpaper" title={t('settings.appearance.wallpaper')} scope="account">
      <div className="theme-choices" role="radiogroup" aria-labelledby="look-wallpaper">
        {WALLPAPER_PATTERNS.map((p) => option(p, t(`settings.wallpaper.${p}` as StringKey), <span className={`theme-swatch wallpaper-swatch wp-${p}`} aria-hidden="true" />))}
        {WALLPAPER_PRESETS.map((p) => option(`preset:${p.id}`, t(`settings.wallpaper.preset.${p.id}` as StringKey),
          <span className="theme-swatch wallpaper-swatch wallpaper-picture" aria-hidden="true" style={{ backgroundImage: `url("/wallpapers/thumbs/${p.id}.webp")` }} />))}
        {w.own && option('own', t('settings.wallpaper.own'),
          <span className="theme-swatch wallpaper-swatch wallpaper-picture" aria-hidden="true" style={{ backgroundImage: `url("/api/v1/me/wallpaper/image?v=${w.own.version}")` }} />)}
      </div>
      <div className="wallpaper-own">
        <h3>{t('settings.wallpaper.yourPicture')}</h3>
        <div className="actions">
          <label className="btn">
            {w.own ? t('settings.wallpaper.replace') : t('settings.wallpaper.upload')}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="visually-hidden" disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          </label>
          {w.own && <button type="button" className="btn btn-quiet" disabled={remove.isPending} onClick={() => remove.mutate()}>{t('settings.wallpaper.remove')}</button>}
        </div>
        <form className="wallpaper-url" onSubmit={(e: FormEvent) => { e.preventDefault(); if (url.trim()) fetchUrl.mutate(url.trim()); }}>
          <TextField label={t('settings.wallpaper.url')} hint={t('settings.wallpaper.urlHint', { mb: WALLPAPER_MAX_BYTES / 1048576 })} value={url} onChange={setUrl} type="url" maxLength={2000} />
          <button className="btn" type="submit" disabled={busy || !url.trim()}>{fetchUrl.isPending ? t('settings.wallpaper.fetching') : t('settings.wallpaper.useUrl')}</button>
        </form>
        {w.own?.source_url && <p className="hint">{t('settings.wallpaper.copiedFrom', { url: w.own.source_url })}</p>}
        {w.own && w.choice === 'own' && (
          <div className="choice-row" role="radiogroup" aria-label={t('settings.wallpaper.fit')}>
            {WALLPAPER_FITS.map((f) => (
              <label key={f} className="check"><input type="radio" name="wallpaper-fit" value={f} checked={w.fit === f} onChange={() => set({ choice: 'own', fit: f })} />{t(`settings.wallpaper.fit.${f}` as StringKey)}</label>
            ))}
          </div>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
    </Section>
  );
}
