import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BODY_MAX, SUBJECT_MAX, type PostPreview, type PostView } from '@app/shared';
import { api } from '../../api';
import { Editor } from '../../components/Editor';
import { FormatHelp } from '../../components/FormatHelp';
import { RichText } from '../../components/RichText';
import { Alert, TextField } from '../../components/ui';
import { clearDraft } from '../../drafts';
import { errorText, useMe, useT } from '../../hooks';
import { quoteReply } from '../../quote';

interface Props {
  slug: string;
  replyTo?: PostView;                 // set when replying
  quote?: { text: string; n: number } | null; // text picked in the post being replied to; quoted at the top
  onPosted: (post: PostView) => void;
  onCancel?: () => void;
}

// Writes a new thread or a reply. The preview comes from the server, so it is exactly the text
// that will be stored, shown the way a 79-column terminal shows it.
export function Composer({ slug, replyTo, quote, onPosted, onCancel }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe().data;
  const draftKey = `board:${slug}:${replyTo?.id ?? 'new'}`;
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = replyTo?.author?.display_name || replyTo?.author?.handle || '';

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
      if (me) clearDraft(me.id, draftKey);
      onPosted(post);
    },
    onError: (e) => setError(errorText(e)),
  });

  // A new piece of picked text goes at the top of what is already written.
  useEffect(() => {
    if (quote?.text) { setBody((b) => `${quoteReply(name, quote.text)}\n${b}`); setPreview(null); }
  }, [quote?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); send.mutate(); };

  return (
    <form className="panel composer" onSubmit={submit} aria-label={replyTo ? t('boards.replyingTo', { name }) : t('boards.newThread')}>
      {replyTo && <p className="muted">{t('boards.replyingTo', { name })}</p>}
      <TextField label={t('boards.compose.subject')} hint={replyTo ? undefined : t('boards.compose.subjectHint')} value={subject} onChange={setSubject}
        maxLength={SUBJECT_MAX} required={!replyTo} />
      <Editor id="compose-body" label={t('boards.compose.body')} mono rows={8} mentions required maxLength={BODY_MAX} draftKey={draftKey} value={body}
        onChange={(v) => { setBody(v); setPreview(null); }} onSubmit={() => { if (body.trim() && !send.isPending) { setError(null); send.mutate(); } }}>
        {replyTo?.body && (
          <button type="button" className="link" onClick={() => setBody((b) => quoteReply(name, replyTo.body!) + b)}>{t('boards.compose.quote')}</button>
        )}
        <FormatHelp />
      </Editor>
      {error && <Alert kind="error">{error}</Alert>}
      {preview && (
        <div className="preview">
          <RichText body={preview.stored} className="post-body" />
          {preview.warnings.map((w) => <Alert key={w} kind="info">{w}</Alert>)}
          <details>
            <summary>{t('boards.compose.previewTerminal')}</summary>
            <pre className="terminal" data-testid="preview">{preview.wrapped.join('\n')}</pre>
          </details>
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
