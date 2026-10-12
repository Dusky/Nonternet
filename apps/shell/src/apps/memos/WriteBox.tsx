import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MEMO_MAX, type MemoView } from '@app/shared';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { WhoSees, type Share } from './WhoSees';
import { Editor } from '../../components/Editor';
import { clearDraft } from '../../drafts';
import { errorText, useMe, useT } from '../../hooks';

// The write box, here and on the home panel. A memo is private; the box says so.
export function WriteBox({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const me = useMe().data;
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<Share>({ visibility: 'private', ring: '' });
  const post = useMutation({
    mutationFn: () => api.post<MemoView>('/memos', { body, visibility: share.visibility, ...(share.visibility === 'ring' ? { ring: share.ring } : {}) }),
    onSuccess: () => {
      if (me) clearDraft(me.id, 'memo:new');
      setBody(''); setError(null); setShare({ visibility: 'private', ring: '' });
      void qc.invalidateQueries({ queryKey: ['memos'] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const [focused, setFocused] = useState(false);
  const send = () => { if (body.trim() && !post.isPending) post.mutate(); };
  return (
    // On a phone an empty, unfocused box folds down to its text area, so the memos are on the first screen.
    <form className={`memo-write${!focused && !body ? ' is-idle' : ''}`} onSubmit={(e) => { e.preventDefault(); send(); }}
      onFocus={() => setFocused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
      <Editor label={t('memos.write')} value={body} onChange={setBody} draftKey="memo:new" maxLength={MEMO_MAX} rows={compact ? 2 : 3} onSubmit={send}
        hint={share.visibility === 'private' ? t('memos.writeHint') : undefined} />
      {!compact && <div className="memo-who"><WhoSees value={share} onChange={setShare} /></div>}
      {error && <Alert kind="error">{error}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={post.isPending || !body.trim()}>{post.isPending ? t('memos.posting') : t('memos.post')}</button>
    </form>
  );
}
