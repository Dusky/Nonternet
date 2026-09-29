import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SUBJECT_MAX, type PostPreview, type PostView } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { quoteReply } from '../../quote';

interface Props {
  slug: string;
  replyTo?: PostView;                 // set when replying
  onPosted: (post: PostView) => void;
  onCancel?: () => void;
}

// Writes a new thread or a reply. The preview comes from the server, so it is exactly the text
// that will be stored, shown the way a 79-column terminal shows it.
export function Composer({ slug, replyTo, onPosted, onCancel }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewIt = useMutation({
    mutationFn: () => api.post<PostPreview>(`/boards/${slug}/posts/preview`, { body }),
    onSuccess: (p) => { setError(null); setPreview(p); },
    onError: (e) => setError(errorText(e)),
  });
  const send = useMutation({
    mutationFn: () => api.post<PostView>(`/boards/${slug}/posts`, {
      body, ...(replyTo ? { reply_to: replyTo.id } : {}), ...(subject.trim() ? { subject } : {}),
    }),
    onSuccess: (post) => {
      void qc.invalidateQueries({ queryKey: ['boards'] });
      void qc.invalidateQueries({ queryKey: ['board', slug] });
      void qc.invalidateQueries({ queryKey: ['threads', slug] });
      void qc.invalidateQueries({ queryKey: ['thread', slug] });
      onPosted(post);
    },
    onError: (e) => setError(errorText(e)),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); send.mutate(); };
  const name = replyTo?.author?.display_name || replyTo?.author?.handle || '';

  return (
    <form className="panel composer" onSubmit={submit} aria-label={replyTo ? t('boards.replyingTo', { name }) : t('boards.newThread')}>
      {replyTo && <p className="muted">{t('boards.replyingTo', { name })}</p>}
      <TextField label={t('boards.compose.subject')} hint={replyTo ? undefined : t('boards.compose.subjectHint')} value={subject} onChange={setSubject}
        maxLength={SUBJECT_MAX} required={!replyTo} />
      <div className="field">
        <label htmlFor="compose-body">{t('boards.compose.body')}</label>
        <textarea id="compose-body" className="mono" rows={8} value={body} onChange={(e) => { setBody(e.target.value); setPreview(null); }} required />
        {replyTo?.body && (
          <button type="button" className="link" onClick={() => setBody((b) => quoteReply(name, replyTo.body!) + b)}>{t('boards.compose.quote')}</button>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {preview && (
        <div className="preview">
          <p className="hint">{t('boards.compose.previewHelp')}</p>
          {preview.warnings.map((w) => <Alert key={w} kind="info">{w}</Alert>)}
          <pre className="terminal" data-testid="preview">{preview.wrapped.join('\n')}</pre>
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={send.isPending || !body.trim()}>
          {send.isPending ? t('boards.compose.posting') : t('boards.compose.post')}
        </button>
        <button type="button" className="btn" disabled={previewIt.isPending || !body.trim()} onClick={() => previewIt.mutate()}>{t('boards.compose.preview')}</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('common.cancel')}</button>}
      </div>
    </form>
  );
}
