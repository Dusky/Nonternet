import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReportView } from '@app/shared';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { ReasonForm } from './ModTools';

type Status = 'open' | 'actioned' | 'dismissed' | 'all';

// The queue for the moderators of a board, and for admins across all boards.
export function ReportQueue() {
  const t = useT();
  const [status, setStatus] = useState<Status>('open');
  const q = useInfiniteQuery({
    queryKey: ['reports', status],
    queryFn: ({ pageParam }) => api.get<{ reports: ReportView[]; next: string | null }>(`/reports?status=${status}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    retry: false,
  });
  const reports = q.data?.pages.flatMap((p) => p.reports) ?? [];
  return (
    <>
      <div className="field">
        <label htmlFor="report-status">{t('boards.reports.status')}</label>
        <select id="report-status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          {(['open', 'actioned', 'dismissed', 'all'] as const).map((s) => <option key={s} value={s}>{t(`boards.reports.status.${s}`)}</option>)}
        </select>
      </div>
      {q.isError && <Alert kind="error">{errorText(q.error)}</Alert>}
      {q.isSuccess && reports.length === 0 && <p>{t('boards.reports.none')}</p>}
      <ul className="rows report-rows">{reports.map((r) => <Report key={r.id} r={r} />)}</ul>
      {q.hasNextPage && <button className="btn" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>{t('boards.more')}</button>}
    </>
  );
}

function Report({ r }: { r: ReportView }) {
  const t = useT();
  const qc = useQueryClient();
  const [tool, setTool] = useState<null | 'hide' | 'remove' | 'dismiss'>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => { setTool(null); setError(null); for (const k of ['reports', 'thread', 'threads', 'modlog']) void qc.invalidateQueries({ queryKey: [k] }); };
  const act = useMutation({
    mutationFn: (reason: string) => (tool === 'dismiss'
      ? api.post(`/reports/${r.id}/resolve`, { resolution: 'dismissed', note: reason })
      : api.post('/mod-actions', { action: tool, post_id: r.post.id, reason })),
    onSuccess: done,
    onError: (e) => setError(errorText(e)),
  });
  const open = r.status === 'open';
  const live = r.post.state === 'ok' || r.post.state === 'hidden';
  return (
    <li>
      <p>
        <strong>{t('boards.reports.by', { name: r.reporter.handle, board: r.board.name })}</strong>{' '}
        <span className="badge">{t(`boards.report.cat.${r.category}`)}</span>{' '}
        {!open && <span className="badge">{t(r.status === 'dismissed' ? 'boards.reports.dismissed' : 'boards.reports.actioned')}</span>}{' '}
        {r.escalated && <span className="badge badge-warn">{t('boards.reports.escalated')}</span>}
      </p>
      {r.note && <p>{r.note}</p>}
      <blockquote className="excerpt">
        {r.post.state === 'ok' || r.post.state === 'hidden'
          ? <><strong>{r.post.subject}</strong>{r.post.author ? ` (${r.post.author})` : ''}<br />{r.post.excerpt}</>
          : <span className="muted">{t('boards.reports.postGone')}</span>}
      </blockquote>
      <p className="hint">
        {formatWhen(r.at)}{r.other_open > 0 ? ` · ${t('boards.reports.others', { count: r.other_open })}` : ''}
        {r.resolved_by ? ` · ${t('boards.reports.resolvedBy', { name: r.resolved_by })}` : ''}{r.resolution_note ? ` · ${r.resolution_note}` : ''}
      </p>
      <div className="mod-tools">
        {live && <OpenAppLink app="boards" to={`${r.board.slug}/t/${r.post.thread_id}`}>{t('boards.reports.open')}</OpenAppLink>}
        {open && live && r.post.state === 'ok' && <button type="button" className="link" onClick={() => setTool('hide')}>{t('boards.mod.hide')}</button>}
        {open && live && <button type="button" className="link" onClick={() => setTool('remove')}>{t('boards.mod.remove')}</button>}
        {open && <button type="button" className="link" onClick={() => setTool('dismiss')}>{t('boards.reports.dismiss')}</button>}
      </div>
      {tool && (
        <ReasonForm label={tool === 'dismiss' ? t('boards.reports.dismiss') : t(`boards.mod.${tool}`)} submitLabel={t('boards.mod.confirm')}
          hint={tool === 'remove' ? t('boards.mod.removeHint') : undefined} pending={act.isPending} error={error} onSubmit={(reason) => act.mutate(reason)} onCancel={() => setTool(null)} />
      )}
    </li>
  );
}
