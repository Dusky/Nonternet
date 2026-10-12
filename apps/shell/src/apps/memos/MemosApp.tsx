import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MEMO_MAX, type MemoPage, type MemoView } from '@app/shared';
import { api } from '../../api';
import { Alert, EmptyState, Loading, RelativeTime, TextField } from '../../components/ui';
import { Editor } from '../../components/Editor';
import { WriteBox } from './WriteBox';
import { MemoThread } from './MemoThread';
import { WhoSees, type Share } from './WhoSees';
import { useAppNav, AppLink } from '../../nav';
import { RichText } from '../../components/RichText';
import { Icon } from '../../components/Icon';
import { undoable, useConfirm } from '../../components/feedback';
import { errorText, useMe, useT } from '../../hooks';

// Memos (docs/22): short notes in a timeline. Write at the top (Ctrl+Enter posts), newest first, pins first. For now every
// memo is private to its writer.

export default function MemosApp() {
  const nav = useAppNav();
  const [a, id] = nav.path.split('/');
  if (a === 'm' && id) return <div className="app-content memos"><MemoThread id={id} /></div>;
  return <Timeline />;
}

function Timeline() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const params = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(tag ? { tag } : {}), ...(pinnedOnly ? { pinned: 'true' } : {}) }).toString();
  const key = ['memos', 'list', params];
  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api.get<MemoPage>(`/memos?${params}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: (prev) => prev,
  });
  const tags = useQuery({ queryKey: ['memos', 'tags'], queryFn: () => api.get<{ tags: { tag: string; count: number }[] }>('/memos/tags') }).data?.tags ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['memos'] });
  const pin = useMutation({
    mutationFn: (m: MemoView) => api.patch(`/memos/${m.id}`, { pinned: !m.pinned }),
    onSettled: () => void refresh(),
  });
  const remove = (m: MemoView) => {
    setGone((s) => new Set(s).add(m.id));
    const back = () => setGone((s) => { const n = new Set(s); n.delete(m.id); return n; });
    undoable(t('memos.deleted'), () => api.del(`/memos/${m.id}`).then(refresh), { onUndo: back, onError: back });
  };
  const items = (list.data?.pages.flatMap((p) => p.memos) ?? []).filter((m) => !gone.has(m.id));
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = Boolean(q.trim() || tag || pinnedOnly);

  return (
    <div className="app-content memos">
      <WriteBox />
      <div className="toolbar memos-filters">
        <TextField label={t('memos.search')} type="search" value={q} onChange={setQ} />
        {tags.length > 0 && (
          <div className="field">
            <label htmlFor="memo-tag">{t('memos.tag')}</label>
            <select id="memo-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">{t('memos.allTags')}</option>
              {tags.map((x) => <option key={x.tag} value={x.tag}>{`#${x.tag} (${x.count})`}</option>)}
            </select>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={pinnedOnly} onChange={(e) => setPinnedOnly(e.target.checked)} /> {t('memos.pinnedOnly')}</label>
      </div>
      {list.isError && <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>}
      {list.isPending && <Loading rows={3} />}
      {list.isSuccess && items.length === 0 && <EmptyState icon="pencil">{filtered ? t('memos.noMatch') : t('memos.none')}</EmptyState>}
      {items.length > 0 && <p className="row-meta" aria-live="polite">{t('memos.count', { count: total })}</p>}
      <ul className="rows memo-rows">
        {items.map((m) => (
          <li key={m.id} className="memo">
            {editing === m.id
              ? <EditMemo m={m} onDone={() => { setEditing(null); void refresh(); }} />
              : (
                <>
                  <RichText body={m.body} className="memo-body" />
                  <p className="row-meta memo-meta">
                    <RelativeTime iso={m.created_at} />
                    {m.edited_at && <> · {t('memos.edited')} <RelativeTime iso={m.edited_at} /></>}
                    {' '}{m.visibility === 'private' && <span className="badge"><Icon name="lock" size={12} /> {t('memos.private')}</span>}
                    {m.visibility === 'public' && <span className="badge">{t('memos.public')}</span>}
                    {m.visibility === 'ring' && m.ring && <span className="badge">{t('memos.inRing', { name: m.ring.name })}</span>}
                    {m.visibility !== 'private' && <> · <AppLink to={`m/${m.id}`}>{m.reply_count > 0 ? t('memos.replies', { count: m.reply_count }) : t('memos.openThread')}</AppLink></>}
                    {m.pinned && <> <span className="badge badge-accent">{t('memos.pinned')}</span></>}
                  </p>
                  {m.hidden && <p className="field-error">{t('memos.hiddenBy', { reason: m.hidden.reason })}</p>}
                  {m.tags.length > 0 && (
                    <ul className="tags" aria-label={t('memos.tags')}>
                      {m.tags.map((x) => <li key={x}><button type="button" className="badge tag" aria-pressed={tag === x} onClick={() => setTag(tag === x ? '' : x)}>#{x}</button></li>)}
                    </ul>
                  )}
                  <div className="memo-actions">
                    <button type="button" className="btn btn-quiet btn-small" aria-pressed={m.pinned} aria-label={`${m.pinned ? t('memos.unpin') : t('memos.pin')}: ${preview(m.body)}`} onClick={() => pin.mutate(m)}>{m.pinned ? t('memos.unpin') : t('memos.pin')}</button>
                    <button type="button" className="btn btn-quiet btn-small" aria-label={`${t('memos.edit')}: ${preview(m.body)}`} onClick={() => setEditing(m.id)}>{t('memos.edit')}</button>
                    <button type="button" className="btn btn-quiet btn-small" aria-label={`${t('memos.delete')}: ${preview(m.body)}`} onClick={() => remove(m)}>{t('memos.delete')}</button>
                  </div>
                </>
              )}
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button type="button" className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('memos.more')}</button>}
    </div>
  );
}

// A short plain-text form of a memo for button names: the markup characters are dropped so a screen reader does not read them out.
export const plainPreview = (body: string) => body.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a: string, b: string) => b || a).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*`_>#]+/g, '').replace(/\s+/g, ' ').trim();
const preview = (raw: string) => { const body = plainPreview(raw); const s = [...body].slice(0, 30).join(''); return s.length < body.length ? `${s}…` : s; };

function EditMemo({ m, onDone }: { m: MemoView; onDone: () => void }) {
  const t = useT();
  const confirm = useConfirm();
  const [body, setBody] = useState(m.body);
  const [share, setShare] = useState<Share>({ visibility: m.visibility, ring: m.ring?.slug ?? '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.patch(`/memos/${m.id}`, { body, visibility: share.visibility, ...(share.visibility === 'ring' ? { ring: share.ring } : {}) }),
    onSuccess: onDone,
    onError: (e) => setError(errorText(e)),
  });
  // Making a private memo visible to others asks once; going back to private never does.
  const submit = async () => {
    if (!body.trim() || save.isPending) return;
    if (m.visibility === 'private' && share.visibility !== 'private') {
      const ok = await confirm({ message: t(share.visibility === 'public' ? 'memos.share.confirmPublic' : 'memos.share.confirmRing'), confirmLabel: t('memos.share.confirm') });
      if (!ok) return;
    }
    save.mutate();
  };
  return (
    <form className="memo-edit" aria-label={t('memos.editing')} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Editor label={t('memos.editLabel')} value={body} onChange={setBody} maxLength={MEMO_MAX} rows={4} saves onSubmit={() => void submit()} />
      <WhoSees value={share} onChange={setShare} />
      {error && <Alert kind="error">{error}</Alert>}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={save.isPending || !body.trim()}>{t('memos.saveChanges')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}
