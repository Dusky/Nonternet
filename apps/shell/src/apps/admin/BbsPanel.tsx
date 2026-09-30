import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

interface BbsState {
  enabled: boolean;
  nodes: { node: number; handle: string; via: string; where: string; since: string }[];
  callers: { handle: string; node: number; via: string; at: string; left_at: string | null }[];
}

// The console's BBS page (docs/11 §6): live nodes and last callers, and letting someone go.
export function BbsPanel() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'bbs'], queryFn: () => api.get<BbsState>('/admin/bbs'), refetchInterval: 5000 });
  const [who, setWho] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const drop = useMutation({
    mutationFn: () => api.post('/admin/bbs/disconnect', { handle: who, reason }),
    onSuccess: () => { setWho(null); setReason(''); void qc.invalidateQueries({ queryKey: ['admin', 'bbs'] }); },
  });
  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  const s = q.data;
  if (!s) return <p className="pad">{t('common.loading')}</p>;
  return (
    <section aria-labelledby="bbs-h">
      <h2 id="bbs-h">{t('admin.bbs.title')}</h2>
      {!s.enabled && <Alert kind="info">{t('admin.bbs.off')}</Alert>}
      <h3>{t('admin.bbs.nodes', { count: s.nodes.length })}</h3>
      {s.nodes.length === 0 ? <p className="muted">{t('admin.bbs.nobody')}</p> : (
        <table className="table">
          <thead><tr><th scope="col">{t('admin.bbs.col.node')}</th><th scope="col">{t('admin.bbs.col.who')}</th><th scope="col">{t('admin.bbs.col.where')}</th><th scope="col">{t('admin.bbs.col.via')}</th><th scope="col">{t('admin.bbs.col.since')}</th><th scope="col"><span className="visually-hidden">{t('admin.bbs.col.actions')}</span></th></tr></thead>
          <tbody>{s.nodes.map((n) => (
            <tr key={n.node}>
              <th scope="row" data-label={t('admin.bbs.col.node')}>{n.node}</th>
              <td data-label={t('admin.bbs.col.who')}>{n.handle}</td>
              <td data-label={t('admin.bbs.col.where')}>{n.where}</td>
              <td data-label={t('admin.bbs.col.via')}>{n.via}</td>
              <td data-label={t('admin.bbs.col.since')}>{formatWhen(n.since)}</td>
              <td><button type="button" className="link" onClick={() => setWho(n.handle)}>{t('admin.bbs.disconnect')}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {who && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); drop.mutate(); }}>
          <p>{t('admin.bbs.disconnectWho', { name: who })}</p>
          <TextField label={t('field.reason')} value={reason} onChange={setReason} required />
          {drop.isError && <Alert kind="error">{errorText(drop.error)}</Alert>}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={drop.isPending}>{t('admin.bbs.disconnect')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setWho(null)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
      <h3>{t('admin.bbs.callers')}</h3>
      {s.callers.length === 0 ? <p className="muted">{t('admin.bbs.noCalls')}</p> : (
        <ol className="timeline">{s.callers.map((c, i) => (
          <li key={i}><time dateTime={c.at}>{formatWhen(c.at)}</time> · <strong>{c.handle}</strong> · {t('admin.bbs.callLine', { node: c.node, via: c.via })}{c.left_at ? '' : ` · ${t('admin.bbs.onNow')}`}</li>
        ))}</ol>
      )}
      <p className="hint">{t('admin.bbs.motdHint')}</p>
    </section>
  );
}
