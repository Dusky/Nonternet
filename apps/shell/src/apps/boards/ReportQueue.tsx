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
  const [tool, setTool] = useState<null | 'hide' | 'remove' | 'dismiss' | 'hide-page' | 'hide-entry' | 'hide-file'>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => { setTool(null); setError(null); for (const k of ['reports', 'thread', 'threads', 'modlog', 'admin']) void qc.invalidateQueries({ queryKey: [k] }); };
  const act = useMutation({
    mutationFn: (reason: string) => {
      if (tool === 'dismiss') return api.post(`/reports/${r.id}/resolve`, { resolution: 'dismissed', note: reason });
      if (tool === 'hide-page') return api.post(`/admin/homepages/${r.target.id}/hide`, { reason });
      if (tool === 'hide-file') return api.post(`/admin/files/${r.target.id}/hide`, { reason });
      if (tool === 'hide-entry') return api.post(`/admin/guestbook/${r.target.id}/hide`, { reason });
      return api.post('/mod-actions', { action: tool, post_id: r.target.id, reason });
    },
    onSuccess: done,
    onError: (e) => setError(errorText(e)),
  });
  const open = r.status === 'open';
  const post = r.post;
  const live = post ? post.state === 'ok' || post.state === 'hidden' : true;
  const title =
    r.target.type === 'post' ? t('boards.reports.by', { name: r.reporter.handle, board: r.board.name })
    : t('boards.reports.byPlain', { name: r.reporter.handle });
  const about = r.target.type === 'homepage' ? t('boards.reports.aboutPage', { name: r.target.handle ?? '' })
    : r.target.type === 'guestbook' ? t('boards.reports.aboutEntry', { name: r.target.handle ?? '' })
    : r.target.type === 'mail_message' ? t('boards.reports.aboutMail', { name: r.target.handle ?? t('mail.deletedPerson') })
    : r.target.type === 'file' ? t('boards.reports.aboutFile', { name: r.target.handle ?? t('mail.deletedPerson') }) : null;
  const label = (k: NonNullable<typeof tool>) => k === 'dismiss' ? t('boards.reports.dismiss') : k === 'hide-page' ? t('boards.reports.hidePage') : k === 'hide-entry' ? t('boards.reports.hideEntry') : k === 'hide-file' ? t('boards.reports.hideFile') : t(`boards.mod.${k}`);
  return (
    <li>
      <p>
        <strong>{title}</strong>{' '}
        <span className="badge">{t(`boards.report.cat.${r.category}`)}</span>{' '}
        {!open && <span className="badge">{t(r.status === 'dismissed' ? 'boards.reports.dismissed' : 'boards.reports.actioned')}</span>}{' '}
        {r.escalated && <span className="badge badge-warn">{t('boards.reports.escalated')}</span>}
      </p>
      {about && <p className="hint">{about}</p>}
      {r.note && <p>{r.note}</p>}
      <blockquote className="excerpt">
        {post
          ? (post.state === 'ok' || post.state === 'hidden'
            ? <><strong>{post.subject}</strong>{post.author ? ` (${post.author})` : ''}<br />{r.excerpt}</>
            : <span className="muted">{t('boards.reports.postGone')}</span>)
          : r.excerpt}
      </blockquote>
      <p className="hint">
        {formatWhen(r.at)}{r.other_open > 0 ? ` · ${t('boards.reports.others', { count: r.other_open })}` : ''}
        {r.resolved_by ? ` · ${t('boards.reports.resolvedBy', { name: r.resolved_by })}` : ''}{r.resolution_note ? ` · ${r.resolution_note}` : ''}
      </p>
      <div className="mod-tools">
        {post && live && <OpenAppLink app="boards" to={`${r.board.slug}/t/${post.thread_id}`}>{t('boards.reports.open')}</OpenAppLink>}
        {r.target.type === 'homepage' && r.target.handle && <OpenAppLink app="homepages" to="">{t('app.homepages')}</OpenAppLink>}
        {open && post && live && post.state === 'ok' && <button type="button" className="link" onClick={() => setTool('hide')}>{t('boards.mod.hide')}</button>}
        {open && post && live && <button type="button" className="link" onClick={() => setTool('remove')}>{t('boards.mod.remove')}</button>}
        {open && r.target.type === 'homepage' && <button type="button" className="link" onClick={() => setTool('hide-page')}>{t('boards.reports.hidePage')}</button>}
        {open && r.target.type === 'guestbook' && <button type="button" className="link" onClick={() => setTool('hide-entry')}>{t('boards.reports.hideEntry')}</button>}
        {r.target.type === 'file' && <OpenAppLink app="files" to="">{t('app.files')}</OpenAppLink>}
        {open && r.target.type === 'file' && <button type="button" className="link" onClick={() => setTool('hide-file')}>{t('boards.reports.hideFile')}</button>}
        {open && <button type="button" className="link" onClick={() => setTool('dismiss')}>{t('boards.reports.dismiss')}</button>}
      </div>
      {tool && (
        <ReasonForm label={label(tool)} submitLabel={t('boards.mod.confirm')}
          hint={tool === 'remove' ? t('boards.mod.removeHint') : undefined} pending={act.isPending} error={error} onSubmit={(reason) => act.mutate(reason)} onCancel={() => setTool(null)} />
      )}
    </li>
  );
}
