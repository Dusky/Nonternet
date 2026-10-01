import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, EmptyState, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { AppLink } from '../../nav';
import { useDebounced } from './useDebounced';

export interface HistoryRow { id: number; at: string; actor_handle: string | null; actor_kind: string; action: string; target_type: string | null; target_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

// ---------------------------------------------------------------- audit log

export function AuditItem({ entry }: { entry: HistoryRow }) {
  const t = useT();
  const who = entry.actor_handle ?? (entry.actor_kind === 'cli' ? t('admin.audit.cli') : t('admin.audit.system'));
  const reason = typeof entry.after?.reason === 'string' ? entry.after.reason : null;
  const change = entry.before?.role && entry.after?.role ? `${String(entry.before.role)} → ${String(entry.after.role)}` : null;
  return (
    <li>
      <time dateTime={entry.at}>{formatWhen(entry.at)}</time>{' '}
      <strong>{entry.action}</strong> <span className="muted">{t('admin.audit.by', { actor: who })}</span>
      {entry.target_type === 'user' && entry.target_id && <> <AppLink to={`users/${entry.target_id}`}>{entry.target_id.slice(0, 10)}</AppLink></>}
      {entry.target_type && entry.target_id && <> <AppLink to={`audit/replay/${encodeURIComponent(entry.target_type)}/${encodeURIComponent(entry.target_id)}`} aria-label={t('admin.replay.linkLabel', { id: entry.target_id })}>{t('admin.replay.link')}</AppLink></>}
      {change && <> <code>{change}</code></>}
      {reason && <> <q>{reason}</q></>}
    </li>
  );
}

export function Audit() {
  const t = useT();
  const [action, setAction] = useState('');
  const da = useDebounced(action);
  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit', da],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '50' });
      if (da) p.set('action', da);
      if (pageParam) p.set('before', String(pageParam));
      return api.get<{ entries: HistoryRow[]; next_before: number | null }>(`/admin/audit?${p}`);
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <>
      <TextField label={t('admin.audit.filter')} value={action} onChange={setAction} hint={t('admin.audit.filterHint')} autoCapitalize="none" spellCheck={false} />
      {query.isError && <Alert kind="error" retry={() => void query.refetch()}>{errorText(query.error)}</Alert>}
      {query.isSuccess && entries.length === 0 && <EmptyState>{t('admin.audit.none')}</EmptyState>}
      {entries.length > 0 && <ol className="timeline">{entries.map((e) => <AuditItem key={e.id} entry={e} />)}</ol>}
      {query.hasNextPage && <button className="btn" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>{t('admin.audit.more')}</button>}
    </>
  );
}

