import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REPORT_CATEGORIES, type MemoView } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { ReasonForm } from '../boards/ModTools';
import { errorText, useMe, useT } from '../../hooks';

const preview = (body: string) => { const s = [...body.replace(/\s+/g, ' ')].slice(0, 30).join(''); return s.length < body.length ? `${s}…` : s; };

// Report (anyone signed in, on someone else's shared memo) and Hide / Put it back (admins, and a ring's ops for its memos).
export function MemoTools({ memo }: { memo: MemoView }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe().data;
  const [tool, setTool] = useState<null | 'report' | 'hide' | 'restore'>(null);
  const act = useMutation({
    mutationFn: (reason: string) => api.post(`/memos/${memo.id}/${tool === 'restore' ? 'restore' : 'hide'}`, { reason }),
    onSuccess: () => { setTool(null); void qc.invalidateQueries({ queryKey: ['memos'] }); void qc.invalidateQueries({ queryKey: ['reports'] }); },
  });
  const canReport = Boolean(me && me.role !== 'guest' && !memo.mine);
  if (!canReport && !memo.can_hide) return null;
  return (
    <>
      <span className="mod-tools">
        {canReport && <button type="button" className="link" aria-label={`${t('memos.report')}: ${preview(memo.body)}`} onClick={() => setTool(tool === 'report' ? null : 'report')}>{t('memos.report')}</button>}
        {memo.can_hide && !memo.hidden && <button type="button" className="link" aria-label={`${t('memos.hide')}: ${preview(memo.body)}`} onClick={() => setTool(tool === 'hide' ? null : 'hide')}>{t('memos.hide')}</button>}
        {memo.can_hide && memo.hidden && <button type="button" className="link" aria-label={`${t('memos.restore')}: ${preview(memo.body)}`} onClick={() => setTool(tool === 'restore' ? null : 'restore')}>{t('memos.restore')}</button>}
      </span>
      {tool === 'report' && <ReportMemo id={memo.id} onDone={() => setTool(null)} />}
      {(tool === 'hide' || tool === 'restore') && (
        <ReasonForm label={tool === 'hide' ? t('memos.hide') : t('memos.restore')} submitLabel={tool === 'hide' ? t('memos.hide') : t('memos.restore')} pending={act.isPending}
          error={act.isError ? errorText(act.error) : null} onSubmit={(reason) => act.mutate(reason)} onCancel={() => setTool(null)} />
      )}
    </>
  );
}

function ReportMemo({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useT();
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('spam');
  const [note, setNote] = useState('');
  const send = useMutation({ mutationFn: () => api.post(`/memos/${id}/report`, { category, note }) });
  if (send.isSuccess) return <p className="muted" role="status">{t('memos.reported')}</p>;
  return (
    <form className="panel" aria-label={t('memos.reportTitle')} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div className="field">
        <label htmlFor={`mcat-${id}`}>{t('boards.report.category')}</label>
        <select id={`mcat-${id}`} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`boards.report.cat.${c}`)}</option>)}
        </select>
      </div>
      <TextField label={t('boards.report.note')} value={note} onChange={setNote} maxLength={500} multiline />
      {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={send.isPending}>{t('boards.report.send')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
