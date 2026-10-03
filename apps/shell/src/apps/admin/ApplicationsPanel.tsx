import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, EmptyState, Loading, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

// Sign-up by application (docs/02): the people waiting, oldest first. Approving lets them in once their email is
// confirmed; declining suspends the account and sends them the reason.
export interface Application { user_id: string; handle: string; email_verified: boolean; text: string; created_at: string }
export const useApplications = (enabled = true) =>
  useQuery({ queryKey: ['admin', 'applications'], queryFn: () => api.get<{ applications: Application[] }>('/admin/applications'), enabled, refetchInterval: 60_000 });

export function ApplicationsPanel() {
  const t = useT();
  const q = useApplications();
  if (!q.data) return q.error ? <Alert kind="error">{errorText(q.error)}</Alert> : <Loading />;
  return (
    <>
      <h2>{t('admin.applications.title')}</h2>
      <p className="hint">{t('admin.applications.intro')}</p>
      {q.data.applications.length === 0 ? <EmptyState>{t('admin.applications.none')}</EmptyState>
        : q.data.applications.map((a) => <One key={a.user_id} a={a} />)}
    </>
  );
}

function One({ a }: { a: Application }) {
  const t = useT();
  const qc = useQueryClient();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'decline') => api.post(`/admin/applications/${a.user_id}`, { decision, ...(decision === 'decline' ? { reason } : {}) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'applications'] }),
  });
  const id = `app-${a.user_id}`;
  return (
    <section className="panel" aria-labelledby={id}>
      <div className="panel-head">
        <h3 id={id}>{a.handle}</h3>
        <span className="hint">{formatWhen(a.created_at)} · {a.email_verified ? t('admin.user.emailOk') : t('admin.user.emailNo')}</span>
      </div>
      <blockquote className="application-text">{a.text}</blockquote>
      {decide.error && <Alert kind="error">{errorText(decide.error)}</Alert>}
      {declining ? (
        <form onSubmit={(e) => { e.preventDefault(); decide.mutate('decline'); }}>
          <TextField label={t('admin.applications.reason')} value={reason} onChange={setReason} hint={t('admin.applications.reasonHint')} multiline maxLength={500} required />
          <div className="toolbar">
            <button type="submit" className="btn btn-danger" disabled={decide.isPending || !reason.trim()}>{t('admin.applications.decline')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setDeclining(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : (
        <div className="toolbar">
          <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={() => decide.mutate('approve')}>{t('admin.applications.approve')}</button>
          <button type="button" className="btn" onClick={() => setDeclining(true)}>{t('admin.applications.decline')}…</button>
        </div>
      )}
    </section>
  );
}
