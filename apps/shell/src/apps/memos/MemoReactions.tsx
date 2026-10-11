import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REACTIONS, type MemoView, type ReactionName } from '@app/shared';
import { api } from '../../api';
import { Alert } from '../../components/ui';
import { errorText, useT } from '../../hooks';

// Reactions on a shared memo or reply: words, not pictures, as on posts. The row shows the server's answer as soon as it comes.
export function MemoReactions({ memo, canReact }: { memo: MemoView; canReact: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [local, setLocal] = useState<MemoView['reactions'] | null>(null);
  const mutate = useMutation({
    mutationFn: ({ name, on }: { name: ReactionName; on: boolean }) =>
      on ? api.put<{ reactions: MemoView['reactions'] }>(`/memos/${memo.id}/reactions/${name}`, {}) : api.del<{ reactions: MemoView['reactions'] }>(`/memos/${memo.id}/reactions/${name}`),
    onSuccess: (r) => { setLocal(r.reactions); void qc.invalidateQueries({ queryKey: ['memos'] }); },
  });
  const shown = local ?? memo.reactions;
  if (!shown.length && !canReact) return null;
  const free = REACTIONS.filter((r) => !shown.some((s) => s.name === r));
  return (
    <div className="reactions" role="group" aria-label={t('react.label')}>
      {shown.map((r) => (
        <button key={r.name} type="button" className={`chip${r.mine ? ' is-on' : ''}`} aria-pressed={r.mine} disabled={!canReact || mutate.isPending}
          onClick={() => mutate.mutate({ name: r.name as ReactionName, on: !r.mine })}>
          {t(`react.${r.name as ReactionName}`)} <span className="count">{r.count}</span>
        </button>
      ))}
      {canReact && free.length > 0 && (
        picking ? (
          <span className="reaction-picker">
            {free.map((name) => <button key={name} type="button" className="chip" onClick={() => { setPicking(false); mutate.mutate({ name, on: true }); }}>{t(`react.${name}`)}</button>)}
            <button type="button" className="link" onClick={() => setPicking(false)}>{t('common.cancel')}</button>
          </span>
        ) : <button type="button" className="link" onClick={() => setPicking(true)}>{t('react.add')}</button>
      )}
      {mutate.isError && <Alert kind="error">{errorText(mutate.error)}</Alert>}
    </div>
  );
}
