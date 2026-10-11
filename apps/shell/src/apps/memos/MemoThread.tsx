import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MEMO_MAX, type MemoView } from '@app/shared';
import { api } from '../../api';
import { Alert, Loading, NotFound, RelativeTime } from '../../components/ui';
import { Editor } from '../../components/Editor';
import { RichText } from '../../components/RichText';
import { Icon } from '../../components/Icon';
import { undoable } from '../../components/feedback';
import { ApiError } from '../../api';
import { AppLink } from '../../nav';
import { PersonLink } from '../people/PersonLink';
import { errorText, useMe, useT } from '../../hooks';
import { MemoReactions } from './MemoReactions';
import { MemoTools } from './MemoTools';

// A shared memo with the replies under it, a reply box, and reactions.
export function MemoThread({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe().data;
  const q = useQuery({ queryKey: ['memos', 'thread', id], queryFn: () => api.get<{ memo: MemoView; replies: MemoView[] }>(`/memos/${id}/thread`), retry: false });
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const reply = useMutation({
    mutationFn: () => api.post<MemoView>(`/memos/${id}/replies`, { body }),
    onSuccess: () => { setBody(''); setError(null); void qc.invalidateQueries({ queryKey: ['memos'] }); },
    onError: (e) => setError(errorText(e)),
  });
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <NotFound /> : <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading rows={3} />;
  const { memo } = q.data;
  const replies = q.data.replies.filter((r) => !gone.has(r.id));
  const signedIn = Boolean(me && me.role !== 'guest');
  const shared = memo.visibility !== 'private';
  const remove = (r: MemoView) => {
    setGone((s) => new Set(s).add(r.id));
    const back = () => setGone((s) => { const n = new Set(s); n.delete(r.id); return n; });
    undoable(t('memos.replyDeleted'), () => api.del(`/memos/${r.id}`).then(() => qc.invalidateQueries({ queryKey: ['memos'] })), { onUndo: back, onError: back });
  };
  return (
    <article className="memo-thread" aria-label={t('memos.thread')}>
      <p><AppLink to="">{t('memos.back')}</AppLink></p>
      <Item memo={memo} headline />
      {memo.hidden && <p className="field-error">{t('memos.hiddenBy', { reason: memo.hidden.reason })}</p>}
      <MemoReactions memo={memo} canReact={signedIn && shared && !memo.hidden} />
      <MemoTools memo={memo} />
      <h3>{t('memos.replies', { count: replies.length })}</h3>
      <ul className="rows memo-replies">
        {replies.map((r) => (
          <li key={r.id} className="memo">
            <Item memo={r} />
            {r.hidden && <p className="field-error">{t('memos.hiddenBy', { reason: r.hidden.reason })}</p>}
            <MemoReactions memo={r} canReact={signedIn && !r.hidden} />
            <span className="memo-actions">
              <MemoTools memo={r} />
              {(r.mine || memo.mine) && <button type="button" className="link" onClick={() => remove(r)}>{t('memos.delete')}</button>}
            </span>
          </li>
        ))}
      </ul>
      {shared && signedIn && !memo.hidden && (
        <form className="memo-write" onSubmit={(e) => { e.preventDefault(); if (body.trim() && !reply.isPending) reply.mutate(); }}>
          <Editor label={t('memos.reply')} value={body} onChange={setBody} draftKey={`memo-reply:${memo.id}`} maxLength={MEMO_MAX} rows={3} onSubmit={() => { if (body.trim() && !reply.isPending) reply.mutate(); }} />
          {error && <Alert kind="error">{error}</Alert>}
          <button type="submit" className="btn btn-primary" disabled={reply.isPending || !body.trim()}>{reply.isPending ? t('memos.posting') : t('memos.postReply')}</button>
        </form>
      )}
    </article>
  );
}

function Item({ memo, headline = false }: { memo: MemoView; headline?: boolean }) {
  const t = useT();
  return (
    <div className={headline ? 'memo-headline' : undefined}>
      <p className="row-meta memo-meta">
        <PersonLink app="people" to={memo.owner.handle}><strong>{memo.owner.display_name || memo.owner.handle}</strong></PersonLink>
        {' · '}<RelativeTime iso={memo.created_at} />{memo.edited_at && <> · {t('memos.edited')}</>}
        {memo.visibility === 'private' && !memo.reply_to && <> <span className="badge"><Icon name="lock" size={12} /> {t('memos.private')}</span></>}
        {memo.ring && <> <span className="badge">{t('memos.inRing', { name: memo.ring.name })}</span></>}
      </p>
      <RichText body={memo.body} className="memo-body" />
    </div>
  );
}
