import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REPORT_CATEGORIES, type BoardSummary, type PostView } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, useT } from '../../hooks';

// A moderator says why, every time. The reason goes in the mod log and the audit log.
export function ReasonForm({ label, hint, submitLabel, pending, error, onSubmit, onCancel, children }: {
  label: string; hint?: string; submitLabel: string; pending: boolean; error: string | null;
  onSubmit: (reason: string) => void; onCancel: () => void; children?: React.ReactNode;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(reason); };
  return (
    <form className="panel mod-form" onSubmit={submit} aria-label={label}>
      {children}
      <TextField label={t('boards.mod.reason')} hint={hint ?? t('boards.mod.reasonHint')} value={reason} onChange={setReason} minLength={3} maxLength={500} required />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>{submitLabel}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function useInvalidateBoards(slug: string) {
  const qc = useQueryClient();
  return () => {
    for (const key of ['thread', 'threads', 'boards', 'board', 'reports', 'modlog']) void qc.invalidateQueries({ queryKey: [key] });
    void qc.invalidateQueries({ queryKey: ['board', slug] });
  };
}

type Tool = null | 'hide' | 'unhide' | 'remove' | 'lock' | 'unlock' | 'move';

// The moderation buttons under a post. Lock and move belong to the whole thread, so they only
// show on its first post.
export function PostModTools({ board, post, isThreadStart, locked }: { board: BoardSummary; post: PostView; isThreadStart: boolean; locked: boolean }) {
  const t = useT();
  const [tool, setTool] = useState<Tool>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const refresh = useInvalidateBoards(board.slug);
  const boards = useQuery({
    queryKey: ['boards', 'movable'],
    queryFn: () => api.get<{ boards: BoardSummary[] }>('/boards'),
    enabled: tool === 'move',
  });
  const targets = (boards.data?.boards ?? []).filter((b) => b.can_moderate && !b.archived && b.slug !== board.slug && b.visibility !== 'ring');
  const run = useMutation({
    mutationFn: (reason: string) => api.post('/mod-actions', { action: tool, post_id: post.id, reason, ...(tool === 'move' ? { to_board: to } : {}) }),
    onSuccess: () => { setTool(null); setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const open = (next: Tool) => { setError(null); setTool(next); };
  const hidden = post.state === 'hidden';
  const live = post.state === 'ok' || hidden;

  return (
    <div className="mod-tools" role="group" aria-label={t('boards.mod.label')}>
      {live && (hidden
        ? <button type="button" className="link" onClick={() => open('unhide')}>{t('boards.mod.unhide')}</button>
        : <button type="button" className="link" onClick={() => open('hide')}>{t('boards.mod.hide')}</button>)}
      {live && <button type="button" className="link" onClick={() => open('remove')}>{t('boards.mod.remove')}</button>}
      {isThreadStart && live && <button type="button" className="link" onClick={() => open(locked ? 'unlock' : 'lock')}>{locked ? t('boards.mod.unlock') : t('boards.mod.lock')}</button>}
      {isThreadStart && live && <button type="button" className="link" onClick={() => open('move')}>{t('boards.mod.move')}</button>}
      {tool && (
        <ReasonForm
          label={t(`boards.mod.${tool}` as 'boards.mod.hide')} submitLabel={t('boards.mod.confirm')} pending={run.isPending} error={error}
          hint={tool === 'remove' ? t('boards.mod.removeHint') : undefined}
          onSubmit={(reason) => { if (tool !== 'move' || to) run.mutate(reason); else setError(t('boards.mod.noBoards')); }} onCancel={() => setTool(null)}
        >
          {tool === 'move' && (
            targets.length === 0 && boards.isSuccess
              ? <p className="muted">{t('boards.mod.noBoards')}</p>
              : (
                <div className="field">
                  <label htmlFor={`move-${post.id}`}>{t('boards.mod.moveTo')}</label>
                  <select id={`move-${post.id}`} value={to} onChange={(e) => setTo(e.target.value)} required>
                    <option value="">…</option>
                    {targets.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
                  </select>
                </div>
              )
          )}
        </ReasonForm>
      )}
    </div>
  );
}

export function ReportPost({ post }: { post: PostView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('spam');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () => api.post('/reports', { post_id: post.id, category, note }),
    onSuccess: () => setError(null),
    onError: (e) => setError(errorText(e)),
  });
  if (send.isSuccess) return <span className="muted" role="status">{t('boards.report.sent')}</span>;
  return (
    <>
      <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{t('boards.report')}</button>
      {open && (
        <form className="panel" aria-label={t('boards.report.title')} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <div className="field">
            <label htmlFor={`cat-${post.id}`}>{t('boards.report.category')}</label>
            <select id={`cat-${post.id}`} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`boards.report.cat.${c}`)}</option>)}
            </select>
          </div>
          <TextField label={t('boards.report.note')} value={note} onChange={setNote} maxLength={500} multiline />
          {error && <Alert kind="error">{error}</Alert>}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={send.isPending}>{t('boards.report.send')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </>
  );
}
