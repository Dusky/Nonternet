import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, EmptyState, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { AppLink } from '../../nav';
import { OpenAppLink } from '../../shell/OpenAppLink';
import { useDebounced } from './useDebounced';

export interface HistoryRow { id: number; at: string; actor_handle: string | null; actor_kind: string; action: string; target_type: string | null; target_id: string | null; target_label?: string | null; target_slug?: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

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
      {entry.target_id && <> <Target entry={entry} /></>}
      {entry.target_type && entry.target_id && <> <AppLink to={`audit/replay/${encodeURIComponent(entry.target_type)}/${encodeURIComponent(entry.target_id)}`} aria-label={t('admin.replay.linkLabel', { id: entry.target_id })}>{t('admin.replay.link')}</AppLink></>}
      {change && <> <code>{change}</code></>}
      {reason && <> <q>{reason}</q></>}
    </li>
  );
}

// Who or what the entry is about, by name (the server looks up the current one), linked to where it lives.
// The full id stays in the tooltip for copying; without a name, the short id is shown.
function Target({ entry }: { entry: HistoryRow }) {
  const id = entry.target_id!;
  const label = entry.target_label ? (entry.target_type === 'user' ? `@${entry.target_label}` : entry.target_label) : id.slice(0, 10);
  if (entry.target_type === 'user') return <AppLink to={`users/${id}`} title={id}>{label}</AppLink>;
  if (entry.target_type === 'board' && entry.target_slug) return <OpenAppLink app="boards" to={entry.target_slug} title={id}>{label}</OpenAppLink>;
  if (entry.target_type === 'ring' && entry.target_slug) return <OpenAppLink app="rings" to={entry.target_slug} title={id}>{label}</OpenAppLink>;
  return entry.target_label ? <span title={id}>{label}</span> : null;
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
      <h2>{t('admin.tab.audit')}</h2>
      <TextField label={t('admin.audit.filter')} value={action} onChange={setAction} hint={t('admin.audit.filterHint')} autoCapitalize="none" spellCheck={false} />
      {query.isError && <Alert kind="error" retry={() => void query.refetch()}>{errorText(query.error)}</Alert>}
      {query.isSuccess && entries.length === 0 && <EmptyState>{t('admin.audit.none')}</EmptyState>}
      {entries.length > 0 && <ol className="timeline">{entries.map((e) => <AuditItem key={e.id} entry={e} />)}</ol>}
      {query.hasNextPage && <button className="btn" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>{t('admin.audit.more')}</button>}
    </>
  );
}

