import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { POST_EDIT_WINDOW_MINUTES, REACTIONS, type BoardSummary, type PostRevisionView, type PostView, type ReactionName } from '@app/shared';
import { api } from '../../api';
import { Editor } from '../../components/Editor';
import { Alert, Loading, RelativeTime, TextField } from '../../components/ui';
import { errorText, useT } from '../../hooks';

// Reactions are words, not pictures, so they read the same on a screen reader and in a terminal.
export function ReactionBar({ post, slug, signedIn, canReact }: { post: PostView; slug: string; signedIn: boolean; canReact: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const mutate = useMutation({
    mutationFn: ({ name, on }: { name: ReactionName; on: boolean }) =>
      on ? api.put(`/posts/${post.id}/reactions/${name}`, {}) : api.del(`/posts/${post.id}/reactions/${name}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['thread', slug] }),
  });
  const shown = post.reactions ?? [];
  if (!shown.length && !(signedIn && canReact)) return null;
  const free = REACTIONS.filter((r) => !shown.some((s) => s.name === r));
  return (
    <div className="reactions" role="group" aria-label={t('react.label')}>
      {shown.map((r) => (
        <button key={r.name} type="button" className={`chip${r.mine ? ' is-on' : ''}`} aria-pressed={r.mine} disabled={!signedIn || !canReact || mutate.isPending}
          onClick={() => mutate.mutate({ name: r.name, on: !r.mine })}>
          {t(`react.${r.name}`)} <span className="count">{r.count}</span>
        </button>
      ))}
      {signedIn && canReact && free.length > 0 && (
        picking ? (
          <span className="reaction-picker">
            {free.map((name) => (
              <button key={name} type="button" className="chip" onClick={() => { setPicking(false); mutate.mutate({ name, on: true }); }}>{t(`react.${name}`)}</button>
            ))}
            <button type="button" className="link" onClick={() => setPicking(false)}>{t('common.cancel')}</button>
          </span>
        ) : <button type="button" className="link" onClick={() => setPicking(true)}>{t('react.add')}</button>
      )}
      {mutate.isError && <Alert kind="error">{errorText(mutate.error)}</Alert>}
    </div>
  );
}

// Can this viewer edit? The server decides; this only decides whether to offer the button.
export function canEditPost(post: PostView, meId: string | undefined, board: BoardSummary, now = Date.now()): { ok: boolean; asMod: boolean } {
  if (post.state !== 'ok' || !meId) return { ok: false, asMod: false };
  if (post.author?.id === meId && now - Date.parse(post.posted_at) < POST_EDIT_WINDOW_MINUTES * 60_000) return { ok: true, asMod: false };
  if (board.can_moderate) return { ok: true, asMod: true };
  return { ok: false, asMod: false };
}

export function EditPost({ post, slug, isStart, asMod, onDone }: { post: PostView; slug: string; isStart: boolean; asMod: boolean; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [subject, setSubject] = useState(post.subject);
  const [body, setBody] = useState(post.body ?? '');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/posts/${post.id}`, { body, ...(isStart ? { subject } : {}), ...(asMod ? { reason } : {}) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['thread', slug] }); void qc.invalidateQueries({ queryKey: ['threads', slug] }); onDone(); },
  });
  const ready = body.trim() && (!asMod || reason.trim().length >= 3);
  return (
    <form className="panel" aria-label={t('edit.label')} onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }}>
      {isStart && <TextField label={t('boards.compose.subject')} value={subject} onChange={setSubject} />}
      <Editor label={t('boards.compose.body')} mono rows={8} mentions value={body} onChange={setBody} onSubmit={() => ready && save.mutate()} />
      {asMod && post.author && <TextField label={t('edit.reason')} hint={t('edit.reasonHint')} value={reason} onChange={setReason} maxLength={300} />}
      {save.isError && <Alert kind="error">{errorText(save.error)}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={!ready || save.isPending}>{t('edit.save')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

// "edited 2 hours ago": opens the earlier versions, newest first.
export function EditedNote({ post }: { post: PostView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['revisions', post.id, post.edited_at], enabled: open, queryFn: () => api.get<{ revisions: PostRevisionView[] }>(`/posts/${post.id}/revisions`) });
  if (!post.edited_at) return null;
  return (
    <span>
      {' · '}
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('edit.edited')} <RelativeTime iso={post.edited_at} />
      </button>
      {open && (
        <div className="revisions panel" role="region" aria-label={t('edit.history')}>
          {q.isLoading && <Loading rows={1} />}
          {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
          {q.data?.revisions.length === 0 && <p className="muted">{t('edit.noHistory')}</p>}
          {q.data?.revisions.slice().reverse().map((r) => (
            <details key={r.id}>
              <summary>
                <RelativeTime iso={r.at} />{r.editor ? ` · ${t('edit.by', { name: r.editor.handle })}` : ''}{r.reason ? ` · ${r.reason}` : ''}
              </summary>
              <pre className="post-body">{r.body}</pre>
            </details>
          ))}
        </div>
      )}
    </span>
  );
}
