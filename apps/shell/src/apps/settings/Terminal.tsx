import { useConfirm, undoable } from '../../components/feedback';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField, EmptyState } from '../../components/ui';
import { Section } from './Section';
import { HelpTip } from '../../components/HelpTip';
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
    <Section id="term-pass-h" title={t('settings.terminal.password')} scope="account" intro={t('terminal.intro')}>
      {site.services.irc && <p className="hint">{t('chat.native', { host: site.irc.host, port: site.irc.port })}</p>}
      {state.data && <p><strong>{state.data.set ? t('terminal.isSet', { when: formatWhen(state.data.set_at) ?? '' }) : t('terminal.notSet')}</strong></p>}
      <form onSubmit={submit} noValidate>
        <TextField label={t('field.currentPassword')} value={password} onChange={setPassword} type="password" hint={t('terminal.currentHint')} autoComplete="current-password" required />
        <TextField label={t('terminal.new')} value={terminal} onChange={setTerminal} type="password" hint={t('terminal.newHint')} autoComplete="new-password" />
        {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={save.isPending || !password || !terminal}>{state.data?.set ? t('terminal.change') : t('terminal.set')}</button>
          {state.data?.set && <button className="btn" type="button" disabled={remove.isPending || !password} onClick={() => { setMsg(null); remove.mutate(); }}>{t('terminal.remove')}</button>}
        </div>
      </form>
    </Section>
  );
}

interface SshKey { id: string; name: string; type: string; fingerprint: string; added_at: string; last_used_at: string | null }

// SSH keys for signing in to the BBS without a password (docs/04). Only the public half is ever sent.
export function SshKeys() {
  const [going, setGoing] = useState<string[]>([]); // removed on screen, waiting out the Undo
  const t = useT();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ssh-keys'], queryFn: () => api.get<{ keys: SshKey[]; max: number }>('/me/ssh-keys') });
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['ssh-keys'] });
  const add = useMutation({ mutationFn: () => api.post('/me/ssh-keys', { name, public_key: key }), onSuccess: () => { setName(''); setKey(''); refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/me/ssh-keys/${id}`), onSuccess: refresh });
  const shownKeys = (q.data?.keys ?? []).filter((k) => !going.includes(k.id));
  return (
    <Section id="ssh-h" title={t('ssh.title')} scope="account">
      <p className="hint">{t('ssh.intro')}</p>
      {q.data && shownKeys.length === 0 && <EmptyState>{t('ssh.none')}</EmptyState>}
      <ul className="rows">
        {shownKeys.map((k) => (
          <li key={k.id}>
            <strong>{k.name}</strong> <span className="muted">{k.type}</span>
            <p className="hint"><code className="checksum">{k.fingerprint}</code></p>
            <p className="hint">{t('ssh.added', { when: formatWhen(k.added_at) ?? '' })} · {k.last_used_at ? t('ssh.used', { when: formatWhen(k.last_used_at) ?? '' }) : t('ssh.neverUsed')}</p>
            <button type="button" className="btn btn-quiet" aria-label={t('ssh.removeLabel', { name: k.name })}
              onClick={() => {
                setGoing((g) => [...g, k.id]);
                undoable(t('ssh.removed', { name: k.name }), () => remove.mutateAsync(k.id), { onUndo: () => setGoing((g) => g.filter((x) => x !== k.id)), onError: () => setGoing((g) => g.filter((x) => x !== k.id)) });
              }}>{t('ssh.remove')}</button>
          </li>
        ))}
      </ul>
      {remove.isError && <Alert kind="error">{errorText(remove.error)}</Alert>}
      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <TextField label={t('ssh.key')} value={key} onChange={setKey} hint={t('ssh.keyHint')} multiline required />
        <TextField label={t('ssh.name')} value={name} onChange={setName} maxLength={60} hint={t('ssh.nameHint')} />
        {add.isError && <Alert kind="error">{errorText(add.error)}</Alert>}
        <button type="submit" className="btn" disabled={add.isPending || !key.trim()}>{t('ssh.add')}</button>
      </form>
    </Section>
  );
}

// QWK offline mail (docs/04): new messages from your boards as a packet for an offline reader, and your
// replies back as a REP packet. Making a packet marks what is in it as read.
export function OfflineMail() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['qwk'], queryFn: () => api.get<{ packet: string; reply: string; conferences: { conf: number; slug: string; name: string }[] }>('/me/qwk') });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const download = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/me/qwk/packet', { method: 'POST', credentials: 'same-origin' });
      if (!res.ok) { const d = await res.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(d?.error?.message ?? t('qwk.failed')); }
      const count = Number(res.headers.get('x-message-count') ?? 0);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = q.data?.packet ?? 'packet.qwk'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return count;
    },
    onSuccess: (n) => { setMsg({ ok: true, text: t('qwk.downloaded', { count: n }) }); void qc.invalidateQueries({ queryKey: ['boards'] }); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<{ posted: number; skipped: { subject: string; reason: string }[] }>('/me/qwk/reply', f, 'POST'),
    onSuccess: (r) => setMsg({ ok: r.skipped.length === 0, text: [t('qwk.posted', { count: r.posted }), ...r.skipped.map((s) => t('qwk.skipped', { subject: s.subject || '-', reason: s.reason }))].join(' ') }),
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  return (
    <Section id="qwk-h" title={t('qwk.title')} scope="account">
      <p className="hint">{t('qwk.short')} <HelpTip topic={t('qwk.title')}><p>{t('qwk.intro')}</p></HelpTip></p>
      {q.data && (
        <p className="hint">{t('qwk.boards', { boards: q.data.conferences.map((c) => `${c.conf} ${c.name}`).join(', ') || '-' })}</p>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => { setMsg(null); download.mutate(); }} disabled={download.isPending}>{t('qwk.download', { name: q.data?.packet ?? '.QWK' })}</button>
      </div>
      <div className="field">
        <label htmlFor="rep-file">{t('qwk.upload', { name: q.data?.reply ?? '.REP' })}</label>
        <input id="rep-file" type="file" accept=".rep,.REP,application/zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setMsg(null); upload.mutate(f); e.target.value = ''; } }} disabled={upload.isPending} />
      </div>
      {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
    </Section>
  );
}
