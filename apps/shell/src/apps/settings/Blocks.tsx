import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockView } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField, EmptyState } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';

export const useBlocks = () => useQuery({ queryKey: ['me', 'blocks'], queryFn: () => api.get<{ blocks: BlockView[] }>('/me/blocks') });

// Blocking (docs/10): the person can't start mail with you or add you to a conversation, and their
// messages are hidden from you in groups you share. They are not told.
export function Blocks() {
  const t = useT();
  const qc = useQueryClient();
  const q = useBlocks();
  const [handle, setHandle] = useState('');
  const done = () => { setHandle(''); void qc.invalidateQueries({ queryKey: ['me', 'blocks'] }); void qc.invalidateQueries({ queryKey: ['mail'] }); };
  const add = useMutation({ mutationFn: () => api.post('/me/blocks', { handle: handle.trim().replace(/^@/, '') }), onSuccess: done });
  const remove = useMutation({ mutationFn: (h: string) => api.post('/me/blocks/remove', { handle: h }), onSuccess: done });
  return (
    <section className="panel" aria-labelledby="blocks-h">
      <h2 id="blocks-h">{t('blocks.title')}</h2>
      <p className="hint">{t('blocks.intro')}</p>
      {q.data && q.data.blocks.length === 0 && <EmptyState>{t('blocks.none')}</EmptyState>}
      <ul className="rows">
        {q.data?.blocks.map((b) => (
          <li key={b.handle}>
            <strong>{b.handle}</strong> <span className="muted">{t('blocks.since', { when: formatWhen(b.since) ?? '' })}</span>{' '}
            <button type="button" className="btn btn-quiet" aria-label={t('blocks.remove', { handle: b.handle })} onClick={() => remove.mutate(b.handle)} disabled={remove.isPending}>{t('blocks.unblock')}</button>
          </li>
        ))}
      </ul>
      {remove.isError && <Alert kind="error">{errorText(remove.error)}</Alert>}
      <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <TextField label={t('blocks.add')} value={handle} onChange={setHandle} hint={t('blocks.addHint')} maxLength={40} autoCapitalize="none" spellCheck={false} required />
        {add.isError && <Alert kind="error">{errorText(add.error)}</Alert>}
        <button type="submit" className="btn" disabled={add.isPending}>{t('blocks.addButton')}</button>
      </form>
    </section>
  );
}
