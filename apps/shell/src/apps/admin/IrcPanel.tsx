import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

interface Overview {
  configured: boolean; bot_connected: boolean; reachable: boolean;
  status: { version: string; start_time: string; users: { total: number; operators: number; max: number }; channels: number } | null;
  channels: { name: string; userCount: number; topic: string; registered: boolean }[];
  online: string[];
  last_sync: { failures: string[] } | null;
}

// The console's IRC page (docs/11): health, live channels and who is on, disconnects and address bans.
export function IrcPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'irc'], queryFn: () => api.get<Overview>('/admin/irc'), refetchInterval: 15_000 });
  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  const o = q.data;
  if (!o) return <p className="pad">{t('common.loading')}</p>;
  if (!o.configured) return <Alert kind="info">{t('admin.irc.off')}</Alert>;
  return (
    <>
      <h2>{t('admin.irc.title')}</h2>
      {!o.reachable && <Alert kind="error">{t('admin.irc.unreachable')}</Alert>}
      {o.reachable && !o.bot_connected && <Alert kind="error">{t('admin.irc.noBot')}</Alert>}
      {o.last_sync && o.last_sync.failures.length > 0 && <Alert kind="error">{t('admin.irc.syncFailures', { count: o.last_sync.failures.length })}</Alert>}
      {o.status && (
        <div className="tiles">
          <div className="tile" role="group" aria-label={t('admin.irc.connected')}><h3>{t('admin.irc.connected')}</h3><p className="tile-value">{o.status.users.total}</p><p className="hint">{t('admin.irc.peak', { count: o.status.users.max })}</p></div>
          <div className="tile" role="group" aria-label={t('admin.irc.channels')}><h3>{t('admin.irc.channels')}</h3><p className="tile-value">{o.status.channels}</p></div>
          <div className="tile" role="group" aria-label={t('admin.irc.server')}><h3>{t('admin.irc.server')}</h3><p className="tile-value">{o.status.version}</p><p className="hint">{t('admin.irc.since', { when: formatWhen(o.status.start_time) ?? '' })}</p></div>
        </div>
      )}
      <h3>{t('admin.irc.liveChannels')}</h3>
      {o.channels.length === 0 ? <p>{t('admin.irc.noChannels')}</p> : (
        <table className="table">
          <thead><tr><th scope="col">{t('admin.irc.col.channel')}</th><th scope="col">{t('admin.irc.col.people')}</th><th scope="col">{t('admin.irc.col.topic')}</th></tr></thead>
          <tbody>{o.channels.map((c) => (
            <tr key={c.name}><th scope="row" data-label={t('admin.irc.col.channel')}>{c.name}{c.registered ? '' : ` ${t('admin.irc.unregistered')}`}</th><td data-label={t('admin.irc.col.people')}>{c.userCount}</td><td data-label={t('admin.irc.col.topic')}>{c.topic}</td></tr>
          ))}</tbody>
        </table>
      )}
      <h3>{t('admin.irc.online', { count: o.online.length })}</h3>
      <p>{o.online.length ? o.online.join(', ') : t('admin.irc.nobody')}</p>
      <OfficialChannel />
      <Disconnect />
      <Bans />
    </>
  );
}

function OfficialChannel() {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const add = useMutation({
    mutationFn: () => api.post<{ name: string }>('/admin/irc/channels', { name, reason }),
    onSuccess: (r) => { setMsg({ ok: true, text: t('admin.irc.officialAdded', { name: r.name }) }); setName(''); setReason(''); void qc.invalidateQueries({ queryKey: ['admin', 'irc'] }); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  return (
    <form className="panel" onSubmit={(e: FormEvent) => { e.preventDefault(); setMsg(null); add.mutate(); }} aria-labelledby="irc-official-h">
      <h3 id="irc-official-h">{t('admin.irc.official')}</h3>
      <TextField label={t('admin.irc.channelName')} value={name} onChange={setName} maxLength={31} autoComplete="off" required />
      <TextField label={t('field.reason')} value={reason} onChange={setReason} maxLength={300} required />
      {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      <button className="btn" type="submit" disabled={add.isPending}>{t('admin.irc.officialAdd')}</button>
    </form>
  );
}

function Disconnect() {
  const t = useT();
  const [nick, setNick] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const kill = useMutation({
    mutationFn: () => api.post('/admin/irc/disconnect', { nick, reason }),
    onSuccess: () => { setMsg({ ok: true, text: t('admin.irc.disconnected', { nick }) }); setNick(''); setReason(''); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  return (
    <form className="panel" onSubmit={(e: FormEvent) => { e.preventDefault(); setMsg(null); kill.mutate(); }} aria-labelledby="irc-kill-h">
      <h3 id="irc-kill-h">{t('admin.irc.disconnect')}</h3>
      <p className="hint">{t('admin.irc.disconnectHint')}</p>
      <TextField label={t('admin.irc.nick')} value={nick} onChange={setNick} maxLength={32} autoComplete="off" required />
      <TextField label={t('field.reason')} value={reason} onChange={setReason} maxLength={300} required />
      {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
      <button className="btn" type="submit" disabled={kill.isPending}>{t('admin.irc.disconnectButton')}</button>
    </form>
  );
}

function Bans() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'irc', 'bans'], queryFn: () => api.get<{ bans: string[] }>('/admin/irc/bans') });
  const [target, setTarget] = useState('');
  const [duration, setDuration] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'irc', 'bans'] });
  const add = useMutation({
    mutationFn: () => api.post('/admin/irc/bans', { target, reason, ...(duration ? { duration } : {}) }),
    onSuccess: () => { setMsg({ ok: true, text: t('admin.irc.banAdded', { target }) }); setTarget(''); setDuration(''); setReason(''); void refresh(); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const remove = useMutation({
    mutationFn: (x: string) => api.post('/admin/irc/bans/remove', { target: x }),
    onSuccess: () => { setMsg({ ok: true, text: t('admin.irc.banRemoved') }); void refresh(); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  return (
    <section className="panel" aria-labelledby="irc-bans-h">
      <h3 id="irc-bans-h">{t('admin.irc.bans')}</h3>
      <p className="hint">{t('admin.irc.bansHint')}</p>
      {list.isError && <Alert kind="error">{errorText(list.error)}</Alert>}
      {list.data && (list.data.bans.length === 0 ? <p>{t('admin.irc.noBans')}</p> : <ul>{list.data.bans.map((b) => <li key={b}><code>{b}</code></li>)}</ul>)}
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setMsg(null); add.mutate(); }}>
        <TextField label={t('admin.irc.banTarget')} value={target} onChange={setTarget} hint={t('admin.irc.banTargetHint')} maxLength={50} autoComplete="off" required />
        <TextField label={t('admin.irc.banDuration')} value={duration} onChange={setDuration} hint={t('admin.irc.banDurationHint')} maxLength={5} autoComplete="off" />
        <TextField label={t('field.reason')} value={reason} onChange={setReason} maxLength={300} required />
        {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
        <div className="actions">
          <button className="btn" type="submit" disabled={add.isPending}>{t('admin.irc.banAdd')}</button>
          <button className="btn" type="button" disabled={remove.isPending || !target} onClick={() => { setMsg(null); remove.mutate(target); }}>{t('admin.irc.banRemove')}</button>
        </div>
      </form>
    </section>
  );
}
