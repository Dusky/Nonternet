import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BODY_MAX, POLL_OPTION_MAX, POLL_QUESTION_MAX, POLL_THREAD_OPTIONS_MAX, SUBJECT_MAX, type PostPreview, type PostView } from '@app/shared';
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
  const [pollOn, setPollOn] = useState(false);
  const [question, setQuestion] = useState('');
  const [choices, setChoices] = useState(['', '']);
  const [days, setDays] = useState('');
  const filled = choices.map((c) => c.trim()).filter(Boolean);
  const poll = !replyTo && pollOn ? { question: question.trim(), options: filled, ...(days.trim() ? { closes_in_days: Number(days) } : {}) } : null;
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
      body, ...(replyTo ? { reply_to: replyTo.id } : {}), ...(subject.trim() ? { subject } : {}), ...(poll ? { poll } : {}),
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
      <Editor id="compose-body" label={t('boards.compose.body')} mono rows={8} mentions pictures required maxLength={BODY_MAX} draftKey={draftKey} value={body}
        onChange={(v) => { setBody(v); setPreview(null); }} onSubmit={() => { if (body.trim() && !send.isPending) { setError(null); send.mutate(); } }}>
        {replyTo?.body && (
          <button type="button" className="link" onClick={() => setBody((b) => quoteReply(name, replyTo.body!) + b)}>{t('boards.compose.quote')}</button>
        )}
        <FormatHelp />
      </Editor>
      {!replyTo && (
        <details className="poll-form" open={pollOn} onToggle={(e) => setPollOn((e.currentTarget as HTMLDetailsElement).open)}>
          <summary>{t('boards.compose.addPoll')}</summary>
          <TextField label={t('boards.compose.pollQuestion')} value={question} onChange={setQuestion} maxLength={POLL_QUESTION_MAX} />
          {choices.map((c, i) => <TextField key={i} label={t('boards.compose.pollChoice', { n: i + 1 })} value={c} onChange={(v) => setChoices((cs) => cs.map((x, j) => (j === i ? v : x)))} maxLength={POLL_OPTION_MAX} />)}
          {choices.length < POLL_THREAD_OPTIONS_MAX && <p><button type="button" className="btn btn-quiet" onClick={() => setChoices((cs) => [...cs, ''])}>{t('boards.compose.pollAdd')}</button></p>}
          <TextField label={t('boards.compose.pollDays')} value={days} onChange={(v) => setDays(v.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" />
        </details>
      )}
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
        <button type="submit" className="btn btn-primary" disabled={send.isPending || !body.trim() || (poll !== null && (poll.question.length < 3 || poll.options.length < 2))}>
          {send.isPending ? t('boards.compose.posting') : t('boards.compose.post')}
        </button>
        <button type="button" className="btn" disabled={previewIt.isPending || !body.trim()} onClick={() => previewIt.mutate()}>{t('boards.compose.preview')}</button>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('common.cancel')}</button>}
      </div>
    </form>
  );
}
