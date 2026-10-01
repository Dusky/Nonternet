import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminVouchCandidate } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField, Loading, EmptyState } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { AppLink } from '../../nav';

interface Queue { candidates: AdminVouchCandidate[]; needed: number; hints: { minAgeDays: number; minPosts: number; cleanDays: number } }

// Vouching (docs/03): people trusted users have vouched for. An admin confirms or declines; nothing is automatic.
export function VouchesPanel() {
  const t = useT();
  const q = useQuery({ queryKey: ['admin', 'vouches'], queryFn: () => api.get<Queue>('/admin/vouches') });
  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading />;
  return (
    <section aria-labelledby="vouches-h">
      <h2 id="vouches-h">{t('admin.vouches.title')}</h2>
      <p className="hint">{t('admin.vouches.intro', { count: q.data.needed })}</p>
      {q.data.candidates.length === 0 ? <EmptyState>{t('admin.vouches.none')}</EmptyState> : (
        <ul className="rows">{q.data.candidates.map((c) => <Candidate key={c.user.id} c={c} q={q.data} />)}</ul>
      )}
    </section>
  );
}

function Candidate({ c, q }: { c: AdminVouchCandidate; q: Queue }) {
  const t = useT();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'confirm' | 'decline' | null>(null);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: () => api.post(`/admin/vouches/${c.user.id}/${mode}`, mode === 'confirm' ? (reason.trim() ? { reason } : {}) : { reason }),
    onSuccess: () => { setMode(null); setReason(''); void qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
  const h = c.hints;
  const hint = (ok: boolean, text: string) => <li className={ok ? undefined : 'muted'}>{ok ? '✓' : '✗'} {text}</li>;
  return (
    <li>
      <p>
        <AppLink to={`users/${c.user.id}`}><strong>{c.user.handle}</strong></AppLink>{' '}
        {c.ready ? <span className="badge badge-open">{t('admin.vouches.ready')}</span> : <span className="badge">{t('admin.vouches.waiting', { count: c.vouches.filter((v) => v.counts).length, needed: q.needed })}</span>}
      </p>
      <ul className="inline-list" aria-label={t('admin.vouches.hints')}>
        {hint(h.old_enough, t('admin.vouches.age', { days: h.age_days, min: q.hints.minAgeDays }))}
        {hint(h.enough_posts, t('admin.vouches.posts', { count: h.posts, min: q.hints.minPosts }))}
        {hint(h.clean, t('admin.vouches.clean', { count: h.recent_mod_actions, days: q.hints.cleanDays }))}
      </ul>
      <ul>
        {c.vouches.map((v) => (
          <li key={v.id} className={v.counts ? undefined : 'muted'}>
            {t('admin.vouches.by', { name: v.voucher.handle, when: formatWhen(v.at) ?? '' })}
            {v.voucher.flags > 0 && <> <span className="badge badge-warn">{t('admin.vouches.flags', { count: v.voucher.flags })}</span></>}
            {!v.counts && <> {t('admin.vouches.notCounted')}</>}
            {v.note && <><br /><q>{v.note}</q></>}
          </li>
        ))}
      </ul>
      <div className="mod-tools">
        <button type="button" className="link" disabled={!c.ready} onClick={() => setMode('confirm')}>{t('admin.vouches.confirm')}</button>
        <button type="button" className="link" onClick={() => setMode('decline')}>{t('admin.vouches.decline')}</button>
      </div>
      {mode && (
        <form className="panel" onSubmit={(e) => { e.preventDefault(); act.mutate(); }}>
          <TextField label={mode === 'confirm' ? t('admin.vouches.confirmReason') : t('admin.vouches.declineReason')} value={reason} onChange={setReason} maxLength={500}
            hint={mode === 'confirm' ? t('admin.vouches.confirmHint', { name: c.user.handle }) : undefined} />
          {act.isError && <Alert kind="error">{errorText(act.error)}</Alert>}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={act.isPending}>{mode === 'confirm' ? t('admin.vouches.confirmGo', { name: c.user.handle }) : t('admin.vouches.declineGo')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode(null)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </li>
  );
}
