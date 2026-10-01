import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AVATAR_MAX_BYTES, PREF_KINDS, type Me, type PersonalSettings } from '@app/shared';
import { api } from '../../api';
import { Avatar, Alert, TextField } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { FONT_SIZES, usePrefs } from '../../devicePrefs';
import { errorText, useT } from '../../hooks';

// A switch that kept on this account. It shows the choice the moment it is clicked and holds it until the server has
// answered (then it follows what the server says), so it never flickers back while a save is on its way.
function Switch({ label, checked, save }: { label: string; checked: boolean; save: (on: boolean) => Promise<unknown> }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={pending ?? checked} onChange={(e) => {
          const on = e.target.checked;
          setPending(on); setError(null);
          save(on).catch((err) => setError(errorText(err))).finally(() => setPending(null));
        }} />
        {label}
      </label>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

export const usePersonal = () => useQuery({ queryKey: ['me', 'personal'], queryFn: () => api.get<PersonalSettings>('/me/personal') });

// Picture, status line and who may see when you were last here: the "who am I on this site" part of Settings.
export function PersonalProfile({ me }: { me: Me }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = usePersonal();
  const fileInput = useRef<HTMLInputElement>(null);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['me', 'personal'] }); void qc.invalidateQueries({ queryKey: ['avatars'] }); void qc.invalidateQueries({ queryKey: ['profile'] }); void qc.invalidateQueries({ queryKey: ['online'] }); };
  const patch = useMutation({ mutationFn: (body: object) => api.patch('/me', body), onSuccess: () => { setError(null); refresh(); toast(t('settings.profile.saved')); }, onError: (e) => setError(errorText(e)) });
  const upload = useMutation({
    mutationFn: (f: File) => api.upload('/me/avatar', f, 'PUT'),
    onSuccess: () => { setError(null); refresh(); toast(t('settings.avatar.saved')); },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({ mutationFn: () => api.del('/me/avatar'), onSuccess: () => { refresh(); toast(t('settings.avatar.removed')); } });
  const saveFlag = (v: object) => api.patch('/me', v).then(() => { refresh(); });
  const p = q.data;
  if (!p) return null;
  const shown = line ?? p.status_line ?? '';
  return (
    <section className="panel" aria-labelledby="personal-h">
      <h2 id="personal-h">{t('settings.personal.title')}</h2>
      <div className="avatar-edit">
        <Avatar id={me.id} name={me.display_name || me.handle} size="lg" />
        <div>
          <p className="hint">{t('settings.avatar.hint', { mb: AVATAR_MAX_BYTES / 1048576 })}</p>
          <div className="actions">
            <label className="btn">
              {p.has_avatar ? t('settings.avatar.change') : t('settings.avatar.choose')}
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" disabled={upload.isPending}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
            </label>
            {p.has_avatar && <button type="button" className="btn btn-quiet" disabled={remove.isPending} onClick={() => remove.mutate()}>{t('settings.avatar.remove')}</button>}
          </div>
        </div>
      </div>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); patch.mutate({ status_line: shown.trim() || null }); }}>
        <TextField label={t('settings.status.label')} hint={t('settings.status.hint')} value={shown} onChange={setLine} maxLength={80} />
        <button className="btn" type="submit" disabled={patch.isPending || shown === (p.status_line ?? '')}>{t('settings.status.save')}</button>
      </form>
      <Switch label={t('settings.status.away')} checked={p.away} save={(on) => saveFlag({ away: on })} />
      <Switch label={t('settings.lastSeen')} checked={p.show_last_seen} save={(on) => saveFlag({ show_last_seen: on })} />
      {error && <Alert kind="error">{error}</Alert>}
    </section>
  );
}

// What the site tells you about, kept on your account (as opposed to the alerts on this device, next to it).
export function NotificationChoices() {
  const t = useT();
  const qc = useQueryClient();
  const q = usePersonal();
  const refresh = () => qc.invalidateQueries({ queryKey: ['me', 'personal'] });
  const savePref = (kind: string, enabled: boolean) => api.put('/me/notification-prefs', { kind, enabled }).then(() => refresh());
  const saveDigest = (on: boolean) => api.patch('/me', { email_digest: on }).then(() => refresh());
  const unmute = useMutation({ mutationFn: (slug: string) => api.del(`/boards/${slug}/mute`), onSuccess: refresh });
  const p = q.data;
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!p) return null;
  return (
    <section aria-labelledby="choices-h">
      <h2 id="choices-h">{t('settings.choices.title')}</h2>
      <p className="hint">{t('settings.choices.intro')}</p>
      <fieldset>
        <legend>{t('settings.choices.kinds')}</legend>
        {PREF_KINDS.map((k) => (
          <Switch key={k} label={t(`settings.choices.${k}`)} checked={p.prefs[k]} save={(on) => savePref(k, on)} />
        ))}
      </fieldset>
      <fieldset>
        <legend>{t('settings.choices.muted')}</legend>
        {p.muted_boards.length === 0 ? <p className="muted">{t('settings.choices.noMuted')}</p> : (
          <ul className="plain">
            {p.muted_boards.map((b) => (
              <li key={b.slug}>{b.name} <button type="button" className="link" onClick={() => unmute.mutate(b.slug)}>{t('settings.choices.unmute')}</button></li>
            ))}
          </ul>
        )}
        <p className="hint">{t('settings.choices.mutedHint')}</p>
      </fieldset>
      {p.can_email && (
        <Switch label={t('settings.choices.digest')} checked={p.email_digest} save={saveDigest} />
      )}
    </section>
  );
}

export function ChatSettings() {
  const t = useT();
  const [prefs, set] = usePrefs('chat');
  return (
    <section aria-labelledby="chat-prefs-h">
      <h2 id="chat-prefs-h">{t('settings.chat.title')}</h2>
      <label className="check"><input type="checkbox" checked={prefs.timestamps} onChange={(e) => set({ timestamps: e.target.checked })} /> {t('settings.chat.timestamps')}</label>
      <label className="check"><input type="checkbox" checked={prefs.joinPart} onChange={(e) => set({ joinPart: e.target.checked })} /> {t('settings.chat.joinPart')}</label>
      <p className="hint">{t('settings.appearance.thisDevice')}</p>
    </section>
  );
}

export function BoardSettings() {
  const t = useT();
  const [prefs, set] = usePrefs('boards');
  return (
    <section aria-labelledby="board-prefs-h">
      <h2 id="board-prefs-h">{t('settings.boards.title')}</h2>
      <div className="field">
        <label htmlFor="board-view">{t('settings.boards.view')}</label>
        <select id="board-view" value={prefs.view} onChange={(e) => set({ view: e.target.value as 'flat' | 'threaded' })}>
          <option value="flat">{t('boards.view.flat')}</option>
          <option value="threaded">{t('boards.view.threaded')}</option>
        </select>
      </div>
      <label className="check"><input type="checkbox" checked={prefs.reactions} onChange={(e) => set({ reactions: e.target.checked })} /> {t('settings.boards.reactions')}</label>
      <p className="hint">{t('settings.appearance.thisDevice')}</p>
    </section>
  );
}

export function TerminalDisplay() {
  const t = useT();
  const [prefs, set] = usePrefs('terminal');
  return (
    <section className="panel" aria-labelledby="term-display-h">
      <h2 id="term-display-h">{t('settings.terminal.display')}</h2>
      <div className="field">
        <label htmlFor="term-size">{t('settings.terminal.fontSize')}</label>
        <select id="term-size" value={prefs.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })}>
          {FONT_SIZES.map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </div>
      <label className="check"><input type="checkbox" checked={prefs.reader} onChange={(e) => set({ reader: e.target.checked })} /> {t('terminal.reader')}</label>
      <p className="hint">{t('settings.appearance.thisDevice')}</p>
    </section>
  );
}
