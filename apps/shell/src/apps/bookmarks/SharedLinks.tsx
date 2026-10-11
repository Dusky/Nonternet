import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { REPORT_CATEGORIES, type SharedBookmarkPage, type SharedBookmarkView } from '@app/shared';
import { api } from '../../api';
import { Alert, RelativeTime, TextField } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { FeedLink } from '../../components/FeedLink';
import { ReasonForm } from '../boards/ModTools';
import { errorText, useMe, useT } from '../../hooks';

// Bookmarks other people can see (docs/21): a person's public ones on their profile, or what a ring's members shared on
// its page. Anyone signed in can report one; admins (and a ring's ops, for its links) can hide one with a reason.
export function SharedLinks({ source, title, headingId, feed }: { source: { handle: string } | { ring: string }; title: string; headingId: string; feed?: { href: string; title: string } }) {
  const path = 'handle' in source ? `/bookmarks/public/${encodeURIComponent(source.handle)}` : `/rings/${encodeURIComponent(source.ring)}/bookmarks`;
  const q = useQuery({ queryKey: ['bookmarks', 'shared', path], queryFn: () => api.get<SharedBookmarkPage>(path) });
  const items = q.data?.bookmarks ?? [];
  if (!items.length) return null;
  return (
    <section aria-labelledby={headingId} className="panel">
      <div className="panel-head">
        <h3 id={headingId}>{title}</h3>
        {feed && <FeedLink href={feed.href} title={feed.title} />}
      </div>
      <ul className="rows shared-links">{items.map((b) => <SharedLink key={b.id} b={b} showOwner={'ring' in source} />)}</ul>
    </section>
  );
}

function SharedLink({ b, showOwner }: { b: SharedBookmarkView; showOwner: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe().data;
  const [tool, setTool] = useState<null | 'report' | 'hide'>(null);
  const hide = useMutation({
    mutationFn: (reason: string) => api.post(`/bookmarks/${b.id}/hide`, { reason }),
    onSuccess: () => { setTool(null); void qc.invalidateQueries({ queryKey: ['bookmarks', 'shared'] }); void qc.invalidateQueries({ queryKey: ['reports'] }); },
  });
  const canReport = me && me.id !== b.owner.id && me.role !== 'guest';
  return (
    <li className="shared-link">
      <a href={b.url} target="_blank" rel="noopener noreferrer nofollow" className="home-bookmark">
        {b.has_icon ? <img src={`/api/v1/bookmarks/${b.id}/icon`} alt="" width={16} height={16} loading="lazy" /> : <Icon name="link" size={16} />}
        <span>{b.title}</span>
      </a>
      <span className="row-meta">
        {' '}{b.host}{showOwner && <> · {b.owner.display_name || b.owner.handle}</>} · <RelativeTime iso={b.created_at} />
      </span>
      {b.description && <p className="bookmark-desc">{b.description}</p>}
      {(canReport || b.can_hide) && (
        <div className="mod-tools">
          {canReport && <button type="button" className="link" aria-label={`${t('bookmarks.report')}: ${b.title}`} onClick={() => setTool(tool === 'report' ? null : 'report')}>{t('bookmarks.report')}</button>}
          {b.can_hide && <button type="button" className="link" aria-label={`${t('bookmarks.hide')}: ${b.title}`} onClick={() => setTool(tool === 'hide' ? null : 'hide')}>{t('bookmarks.hide')}</button>}
        </div>
      )}
      {tool === 'report' && <ReportBookmark id={b.id} title={b.title} onDone={() => setTool(null)} />}
      {tool === 'hide' && (
        <ReasonForm label={t('bookmarks.hideTitle', { title: b.title })} submitLabel={t('bookmarks.hide')} pending={hide.isPending}
          error={hide.isError ? errorText(hide.error) : null} onSubmit={(reason) => hide.mutate(reason)} onCancel={() => setTool(null)} />
      )}
    </li>
  );
}

function ReportBookmark({ id, title, onDone }: { id: string; title: string; onDone: () => void }) {
  const t = useT();
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('spam');
  const [note, setNote] = useState('');
  const send = useMutation({ mutationFn: () => api.post(`/bookmarks/${id}/report`, { category, note }) });
  if (send.isSuccess) return <p className="muted" role="status">{t('bookmarks.reported')}</p>;
  return (
    <form className="panel" aria-label={t('bookmarks.reportTitle', { title })} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div className="field">
        <label htmlFor={`bcat-${id}`}>{t('boards.report.category')}</label>
        <select id={`bcat-${id}`} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
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
