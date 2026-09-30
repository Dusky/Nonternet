import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, formatWhen, useSite, useT } from '../../hooks';

// A separate password for IRC clients and, later, telnet and the MUD (docs/02). Leaking it doesn't
// expose the website account.
export function TerminalPassword() {
  const t = useT();
  const site = useSite();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['terminal-password'], queryFn: () => api.get<{ set: boolean; set_at: string | null }>('/me/terminal-password') });
  const [password, setPassword] = useState('');
  const [terminal, setTerminal] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const done = (text: string) => { setMsg({ ok: true, text }); setPassword(''); setTerminal(''); void qc.invalidateQueries({ queryKey: ['terminal-password'] }); };
  const save = useMutation({ mutationFn: () => api.put('/me/terminal-password', { password, terminal_password: terminal }), onSuccess: () => done(t('terminal.saved')), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  const remove = useMutation({ mutationFn: () => api.post('/me/terminal-password/remove', { password }), onSuccess: () => done(t('terminal.removed')), onError: (e) => setMsg({ ok: false, text: errorText(e) }) });
  const submit = (e: FormEvent) => { e.preventDefault(); setMsg(null); save.mutate(); };
  return (
    <>
      <p>{t('terminal.intro')}</p>
      {site.services.irc && <p className="hint">{t('chat.native', { host: site.irc.host, port: site.irc.port })}</p>}
      {state.data && <p><strong>{state.data.set ? t('terminal.isSet', { when: formatWhen(state.data.set_at) ?? '' }) : t('terminal.notSet')}</strong></p>}
      <form onSubmit={submit} noValidate>
        <TextField label={t('field.currentPassword')} value={password} onChange={setPassword} type="password" hint={t('terminal.currentHint')} autoComplete="current-password" required />
        <TextField label={t('terminal.new')} value={terminal} onChange={setTerminal} type="password" hint={t('terminal.newHint')} autoComplete="new-password" />
        {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={save.isPending}>{state.data?.set ? t('terminal.change') : t('terminal.set')}</button>
          {state.data?.set && <button className="btn" type="button" disabled={remove.isPending} onClick={() => { setMsg(null); remove.mutate(); }}>{t('terminal.remove')}</button>}
        </div>
      </form>
    </>
  );
}
