import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField, Loading } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { TowerBoard } from '../../shell/TowerBoard';

interface Overview {
  configured: boolean; reachable: boolean;
  status: { name: string; sessions: { account: string | null; character: string | null; room: string | null; idle_s: number; protocol: string }[]; rooms: { room: string; people: number }[]; counts: { accounts: number; characters: number; rooms: number; objects: number } } | null;
}
interface Builder { op_id: string; user_id: string; handle: string; since: string }

// The console's MUD page (docs/11): who is playing and where, the size of the world, and builders.
export function MudPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'mud'], queryFn: () => api.get<Overview>('/admin/mud'), refetchInterval: 15_000 });
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const o = q.data;
  if (!o) return <Loading />;
  if (!o.configured) return <Alert kind="info">{t('admin.mud.off')}</Alert>;
  const s = o.status;
  return (
    <>
      <h2>{t('admin.mud.title')}</h2>
      {!o.reachable && <Alert kind="error">{t('admin.mud.unreachable')}</Alert>}
      {s && (
        <>
          <div className="tiles">
            <div className="tile" role="group" aria-label={t('admin.mud.playing')}><h3>{t('admin.mud.playing')}</h3><p className="tile-value">{s.sessions.length}</p></div>
            <div className="tile" role="group" aria-label={t('admin.mud.characters')}><h3>{t('admin.mud.characters')}</h3><p className="tile-value">{s.counts.characters}</p><p className="hint">{t('admin.mud.accounts', { count: s.counts.accounts })}</p></div>
            <div className="tile" role="group" aria-label={t('admin.mud.world')}><h3>{t('admin.mud.world')}</h3><p className="tile-value">{s.counts.rooms}</p><p className="hint">{t('admin.mud.objects', { count: s.counts.objects })}</p></div>
          </div>
          <h3>{t('admin.mud.who')}</h3>
          {s.sessions.length === 0 ? <p>{t('admin.mud.nobody')}</p> : (
            <table className="table">
              <thead><tr><th scope="col">{t('admin.mud.col.person')}</th><th scope="col">{t('admin.mud.col.character')}</th><th scope="col">{t('admin.mud.col.room')}</th><th scope="col">{t('admin.mud.col.via')}</th></tr></thead>
              <tbody>{s.sessions.map((x, i) => (
                <tr key={`${x.account}-${i}`}><th scope="row" data-label={t('admin.mud.col.person')}>{x.account}</th><td data-label={t('admin.mud.col.character')}>{x.character ?? '–'}</td><td data-label={t('admin.mud.col.room')}>{x.room ?? '–'}</td><td data-label={t('admin.mud.col.via')}>{x.protocol}</td></tr>
              ))}</tbody>
            </table>
          )}
          {s.rooms.length > 0 && <><h3>{t('admin.mud.busy')}</h3><ul>{s.rooms.map((r) => <li key={r.room}>{r.room}: {t('admin.mud.people', { count: r.people })}</li>)}</ul></>}
        </>
      )}
      <TowerBoard limit={20} headingId="admin-tower" />
      <Builders />
    </>
  );
}

function Builders() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'mud', 'builders'], queryFn: () => api.get<{ builders: Builder[] }>('/admin/mud/builders') });
  const [handle, setHandle] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'mud', 'builders'] });
  const add = useMutation({
    mutationFn: () => api.post('/admin/mud/builders', { handle, reason }),
    onSuccess: () => { setMsg({ ok: true, text: t('admin.mud.builderAdded', { name: handle }) }); setHandle(''); setReason(''); void refresh(); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  const remove = useMutation({
    mutationFn: (b: Builder) => api.post('/admin/mud/builders/remove', { user_id: b.user_id, op_id: b.op_id, reason: reason || 'no longer building' }),
    onSuccess: () => { setMsg({ ok: true, text: t('admin.mud.builderRemoved') }); void refresh(); },
    onError: (e) => setMsg({ ok: false, text: errorText(e) }),
  });
  return (
    <section className="panel" aria-labelledby="mud-builders-h">
      <h3 id="mud-builders-h">{t('admin.mud.builders')}</h3>
      <p className="hint">{t('admin.mud.buildersHint')}</p>
      {list.data && (list.data.builders.length === 0 ? <p>{t('admin.mud.noBuilders')}</p> : (
        <ul>{list.data.builders.map((b) => (
          <li key={b.op_id}>{b.handle} <span className="hint">{t('admin.mud.since', { when: formatWhen(b.since) ?? '' })}</span>{' '}
            <button type="button" className="btn btn-quiet" disabled={remove.isPending} onClick={() => { setMsg(null); remove.mutate(b); }} aria-label={t('admin.mud.removeBuilder', { name: b.handle })}>{t('admin.user.revoke')}</button>
          </li>
        ))}</ul>
      ))}
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setMsg(null); add.mutate(); }}>
        <TextField label={t('field.handle')} value={handle} onChange={setHandle} maxLength={40} autoComplete="off" required />
        <TextField label={t('field.reason')} value={reason} onChange={setReason} maxLength={500} required />
        {msg && <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
        <button className="btn" type="submit" disabled={add.isPending}>{t('admin.mud.addBuilder')}</button>
      </form>
    </section>
  );
}
