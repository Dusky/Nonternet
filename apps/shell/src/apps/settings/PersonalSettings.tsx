import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AVATAR_MAX_BYTES, PREF_KINDS, type ChatClient, type Me, type PersonalSettings } from '@app/shared';
import { api } from '../../api';
import { Avatar, Alert, TextField } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { BELLS, FONT_SIZES, SCROLLBACKS, usePrefs } from '../../devicePrefs';
import { Section } from './Section';
import { errorText, useT } from '../../hooks';

// A switch that kept on this account. It shows the choice the moment it is clicked and holds it until the server has
// answered (then it follows what the server says), so it never flickers back while a save is on its way.
function Switch({ label, checked, save }: { label: string; checked: boolean; save: (on: boolean) => Promise<unknown> }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <label className="check switch">
        <input type="checkbox" role="switch" checked={pending ?? checked} onChange={(e) => {
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

// The same switch for a choice kept on this device: no saving to wait for.
export function DeviceSwitch({ label, checked, onChange, hint, disabled }: { label: string; checked: boolean; onChange: (on: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className="check switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <> <span className="hint">{hint}</span></>}</span>
    </label>
  );
}

export const usePersonal = (enabled = true) => useQuery({ queryKey: ['me', 'personal'], queryFn: () => api.get<PersonalSettings>('/me/personal'), enabled });

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
    <Section id="personal-h" title={t('settings.personal.title')} scope="account">
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
    </Section>
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
    <Section id="choices-h" title={t('settings.choices.title')} scope="account" intro={t('settings.choices.intro')}>
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
    </Section>
  );
}

export function ChatSettings() {
  const t = useT();
  const [prefs, set] = usePrefs('chat');
  return (
    <Section id="chat-prefs-h" title={t('settings.chat.title')} scope="device">
      <DeviceSwitch label={t('settings.chat.timestamps')} checked={prefs.timestamps} onChange={(on) => set({ timestamps: on })} />
      <DeviceSwitch label={t('settings.chat.joinPart')} checked={prefs.joinPart} onChange={(on) => set({ joinPart: on })} />
    </Section>
  );
}

// Words that count as a mention, and the people you ignore. Kept on the account (exported with it), so they follow
// you to any browser. An open Chat window picks up the change straight away.
export function ChatAccountSettings() {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['client-settings', 'chat'], queryFn: () => api.get<{ settings: ChatClient }>('/me/client-settings/chat') });
  const [words, setWords] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: ChatClient) => api.put<{ settings: ChatClient }>('/me/client-settings/chat', { settings: next }),
    onSuccess: (r) => {
      qc.setQueryData(['client-settings', 'chat'], r);
      window.dispatchEvent(new CustomEvent('client-settings:chat', { detail: r.settings }));
      setWords(null);
      toast(t('common.saved'));
    },
  });
  if (!q.data) return q.error ? <Alert kind="error">{errorText(q.error)}</Alert> : null;
  const s = q.data.settings;
  const text = words ?? s.highlights.join('\n');
  return (
    <Section id="chat-account-h" title={t('settings.chat.account')} scope="account">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate({ ...s, highlights: text.split('\n').map((w) => w.trim()).filter(Boolean).slice(0, 50) }); }}>
        <TextField label={t('settings.chat.highlights')} hint={t('settings.chat.highlightsHint')} multiline value={text} onChange={setWords} />
        {save.error && <Alert kind="error">{errorText(save.error)}</Alert>}
        <button type="submit" className="btn btn-primary" disabled={save.isPending || words === null}>{t('settings.chat.saveHighlights')}</button>
      </form>
      <h3 id="chat-ignore-h">{t('settings.chat.ignoreTitle')}</h3>
      {s.ignore.length === 0 ? <p className="hint">{t('settings.chat.ignoreNone')}</p> : (
        <ul className="plain settings-list" aria-labelledby="chat-ignore-h">
          {s.ignore.map((nick) => (
            <li key={nick}>
              <span>{nick}</span>
              <button type="button" className="btn btn-quiet" disabled={save.isPending} onClick={() => save.mutate({ ...s, ignore: s.ignore.filter((n) => n !== nick) })}>
                {t('settings.chat.unignore', { nick })}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function BoardSettings() {
  const t = useT();
  const [prefs, set] = usePrefs('boards');
  return (
    <Section id="board-prefs-h" title={t('settings.boards.title')} scope="device">
      {/* The same pair of buttons as at the top of a thread. */}
      <div className="field">
        <p className="field-label" id="board-view">{t('settings.boards.view')}</p>
        <div className="toolbar" role="group" aria-labelledby="board-view">
          <button type="button" className={`btn btn-quiet${prefs.view === 'flat' ? ' is-active' : ''}`} aria-pressed={prefs.view === 'flat'} onClick={() => set({ view: 'flat' })}>{t('boards.view.flat')}</button>
          <button type="button" className={`btn btn-quiet${prefs.view === 'threaded' ? ' is-active' : ''}`} aria-pressed={prefs.view === 'threaded'} onClick={() => set({ view: 'threaded' })}>{t('boards.view.threaded')}</button>
        </div>
      </div>
      <DeviceSwitch label={t('settings.boards.reactions')} checked={prefs.reactions} onChange={(on) => set({ reactions: on })} />
    </Section>
  );
}

export function TerminalDisplay() {
  const t = useT();
  const [prefs, set] = usePrefs('terminal');
  return (
    <Section id="term-display-h" title={t('settings.terminal.display')} scope="device">
      <div className="field">
        <label htmlFor="term-size">{t('settings.terminal.fontSize')}</label>
        <select id="term-size" value={prefs.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })}>
          {FONT_SIZES.map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="term-scrollback">{t('settings.terminal.scrollback')}</label>
        <select id="term-scrollback" value={prefs.scrollback} onChange={(e) => set({ scrollback: Number(e.target.value) })}>
          {SCROLLBACKS.map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="term-bell">{t('settings.terminal.bell')}</label>
        <select id="term-bell" value={prefs.bell} onChange={(e) => set({ bell: e.target.value as 'off' | 'flash' | 'sound' })}>
          {BELLS.map((b) => <option key={b} value={b}>{t(`settings.terminal.bell.${b}`)}</option>)}
        </select>
      </div>
      <DeviceSwitch label={t('settings.terminal.copyOnSelect')} checked={prefs.copyOnSelect} onChange={(on) => set({ copyOnSelect: on })} />
      <DeviceSwitch label={t('terminal.reader')} checked={prefs.reader} onChange={(on) => set({ reader: on })} />
    </Section>
  );
}
