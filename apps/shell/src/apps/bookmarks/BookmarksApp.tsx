import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { bookmarkCreateSchema, bookmarkUpdateSchema, bookmarkletSource, sharedAddress, type BookmarkImportResult, type BookmarkPage, type BookmarkView, type BookmarkVisibility } from '@app/shared';
import { api, ApiError } from '../../api';
import { Alert, EmptyState, Loading, RelativeTime, TextField } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { undoable, useToast } from '../../components/feedback';
import { errorText, useT } from '../../hooks';
import { AppLink, useAppNav } from '../../nav';
import { fieldMessages } from '../../components/Form';

// Bookmarks (docs/21): links a person saved, private for now. The list, a screen to add one (the bookmarklet and the
// palette open it with the address filled in), and the bookmarklet itself.

export const splitTags = (s: string): string[] => s.split(/[\s,]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean);
export const iconUrl = (b: BookmarkView) => `/api/v1/bookmarks/${b.id}/icon?v=${encodeURIComponent(b.updated_at)}`;

// The add screen's address and title, from its own path (in a window: "add?url=…") or the page address (on its own page).
function prefill(path: string): { url: string; title: string } {
  const q = path.includes('?') ? path.slice(path.indexOf('?')) : typeof window !== 'undefined' ? window.location.search : '';
  const p = new URLSearchParams(q);
  // The phone's Share menu often puts the address inside `text`, after the title.
  return sharedAddress({ url: p.get('url'), text: p.get('text'), title: p.get('title') });
}

export default function BookmarksApp() {
  const nav = useAppNav();
  const [screen] = nav.path.split(/[/?]/);
  return <div className="app-content bookmarks">{screen === 'add' ? <AddScreen /> : <ListScreen />}</div>;
}

const LIST = ['bookmarks', 'list'];

function ListScreen() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [brokenOnly, setBrokenOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const params = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(tag ? { tag } : {}), ...(pinnedOnly ? { pinned: 'true' } : {}), ...(brokenOnly ? { broken: 'true' } : {}) }).toString();
  const key = [...LIST, params];
  const list = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api.get<BookmarkPage>(`/bookmarks?${params}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: (prev) => prev,
  });
  const tags = useQuery({ queryKey: ['bookmarks', 'tags'], queryFn: () => api.get<{ tags: { tag: string; count: number }[] }>('/bookmarks/tags') }).data?.tags ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['bookmarks'] });
  // Pinning shows at once; a refusal puts it back.
  const pin = useMutation({
    mutationFn: (b: BookmarkView) => api.patch(`/bookmarks/${b.id}`, { pinned: !b.pinned }),
    onMutate: async (b) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData(key);
      qc.setQueryData<InfiniteData<BookmarkPage>>(key, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, bookmarks: p.bookmarks.map((x) => (x.id === b.id ? { ...x, pinned: !b.pinned } : x)) })) });
      return { before };
    },
    onError: (_e, _b, c) => qc.setQueryData(key, c?.before),
    onSettled: () => void refresh(),
  });
  // "Check link": the page is asked once, now; the answer is kept and shown on the row.
  const check = useMutation({
    mutationFn: (b: BookmarkView) => api.post<BookmarkView>(`/bookmarks/${b.id}/check`),
    onSuccess: (b) => {
      qc.setQueryData<InfiniteData<BookmarkPage>>(key, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, bookmarks: p.bookmarks.map((x) => (x.id === b.id ? b : x)) })) });
      void qc.invalidateQueries({ queryKey: ['bookmarks'] });
    },
  });
  const remove = (b: BookmarkView) => {
    setGone((s) => new Set(s).add(b.id));
    undoable(t('bookmarks.removed', { title: b.title }), () => api.del(`/bookmarks/${b.id}`).then(refresh), {
      onUndo: () => setGone((s) => { const n = new Set(s); n.delete(b.id); return n; }),
      onError: () => setGone((s) => { const n = new Set(s); n.delete(b.id); return n; }),
    });
  };
  const items = (list.data?.pages.flatMap((p) => p.bookmarks) ?? []).filter((b) => !gone.has(b.id));
  const total = list.data?.pages[0]?.total ?? 0;
  const filtered = Boolean(q.trim() || tag || pinnedOnly || brokenOnly);

  return (
    <>
      <QuickAdd />
      <div className="toolbar bookmarks-filters">
        <TextField label={t('bookmarks.search')} type="search" value={q} onChange={setQ} />
        {tags.length > 0 && (
          <div className="field">
            <label htmlFor="bm-tag">{t('bookmarks.tag')}</label>
            <select id="bm-tag" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">{t('bookmarks.allTags')}</option>
              {tags.map((x) => <option key={x.tag} value={x.tag}>{`${x.tag} (${x.count})`}</option>)}
            </select>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={pinnedOnly} onChange={(e) => setPinnedOnly(e.target.checked)} /> {t('bookmarks.pinnedOnly')}</label>
        <label className="check"><input type="checkbox" checked={brokenOnly} onChange={(e) => setBrokenOnly(e.target.checked)} /> {t('bookmarks.brokenOnly')}</label>
      </div>
      {list.isError && <Alert kind="error" retry={() => void list.refetch()}>{errorText(list.error)}</Alert>}
      {list.isPending && <Loading rows={4} />}
      {list.isSuccess && items.length === 0 && (filtered ? <EmptyState>{t('bookmarks.noMatch')}</EmptyState> : <EmptyState icon="link">{t('bookmarks.none')}</EmptyState>)}
      {items.length > 0 && <p className="row-meta" aria-live="polite">{t('bookmarks.count', { count: total })}</p>}
      <ul className="rows bookmark-rows">
        {items.map((b) => (
          <li key={b.id} className="bookmark">
            {editing === b.id
              ? <EditForm b={b} onDone={() => { setEditing(null); void refresh(); }} />
              : (
                <>
                  <span className="bookmark-icon" aria-hidden="true">{b.has_icon ? <img src={iconUrl(b)} alt="" width={16} height={16} loading="lazy" /> : <Icon name="link" size={16} />}</span>
                  <div className="bookmark-main">
                    <a className="bookmark-title" href={b.url} target="_blank" rel="noopener noreferrer">{b.title}</a>
                    <span className="row-meta">
                      {b.host} · <RelativeTime iso={b.created_at} />
                      {b.visibility === 'public' && <>{' '}<span className="badge">{t('bookmarks.badge.public')}</span></>}
                      {b.visibility === 'ring' && b.ring && <>{' '}<span className="badge">{t('bookmarks.badge.ring', { name: b.ring.name })}</span></>}
                    </span>
                    {b.checked_at && <p className={b.link_ok ? 'row-meta' : 'field-error'}>{b.link_ok ? t('bookmarks.check.ok') : t('bookmarks.check.bad')} · <RelativeTime iso={b.checked_at} /></p>}
                    {b.hidden && <p className="field-error">{t('bookmarks.hiddenBy', { reason: b.hidden.reason })}</p>}
                    {b.description && <p className="bookmark-desc">{b.description}</p>}
                    {b.tags.length > 0 && (
                      <ul className="tags" aria-label={t('bookmarks.tags')}>
                        {b.tags.map((x) => <li key={x}><button type="button" className="badge tag" aria-pressed={tag === x} onClick={() => setTag(tag === x ? '' : x)}>{x}</button></li>)}
                      </ul>
                    )}
                  </div>
                  <div className="bookmark-actions">
                    <button type="button" className="btn btn-quiet btn-small" aria-pressed={b.pinned} aria-label={`${b.pinned ? t('bookmarks.unpin') : t('bookmarks.pin')}: ${b.title}`} onClick={() => pin.mutate(b)}>
                      {b.pinned ? t('bookmarks.unpin') : t('bookmarks.pin')}
                    </button>
                    <button type="button" className="btn btn-quiet btn-small" aria-label={`${t('bookmarks.check')}: ${b.title}`} disabled={check.isPending && check.variables?.id === b.id} onClick={() => check.mutate(b)}>
                      {check.isPending && check.variables?.id === b.id ? t('bookmarks.checking') : t('bookmarks.check')}
                    </button>
                    <button type="button" className="btn btn-quiet btn-small" aria-label={`${t('bookmarks.edit')}: ${b.title}`} onClick={() => setEditing(b.id)}>{t('bookmarks.edit')}</button>
                    <button type="button" className="btn btn-quiet btn-small" aria-label={`${t('bookmarks.remove')}: ${b.title}`} onClick={() => remove(b)}>{t('bookmarks.remove')}</button>
                  </div>
                </>
              )}
          </li>
        ))}
      </ul>
      {list.hasNextPage && <button type="button" className="btn" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>{t('bookmarks.more')}</button>}
      <ImportFile />
      <Bookmarklet />
    </>
  );
}

// One box at the top: paste an address and press Enter.
function QuickAdd() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (u: string) => api.post<{ bookmark: BookmarkView; existing: boolean }>('/bookmarks', { url: u }),
    onSuccess: (r) => {
      setUrl('');
      toast(r.existing ? t('bookmarks.already', { title: r.bookmark.title }) : t('bookmarks.saved', { title: r.bookmark.title }));
      void qc.invalidateQueries({ queryKey: ['bookmarks'] });
    },
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = bookmarkCreateSchema.shape.url.safeParse(url);
    if (!parsed.success) { setError(fieldMessages(parsed)?.[''] ?? parsed.error.issues[0]!.message); return; }
    setError(null);
    add.mutate(parsed.data);
  };
  return (
    <form className="bookmark-add" onSubmit={submit} noValidate>
      <TextField label={t('bookmarks.addLabel')} type="url" inputMode="url" value={url} onChange={(v) => { setUrl(v); setError(null); }} error={error ?? undefined} placeholder="https://" autoComplete="off" />
      <button type="submit" className="btn btn-primary" disabled={add.isPending}>{add.isPending ? t('bookmarks.saving') : t('bookmarks.save')}</button>
    </form>
  );
}

interface Values { url: string; title: string; description: string; tags: string; pinned: boolean; visibility: BookmarkVisibility; ring: string }
const shareOf = (v: Values) => ({ visibility: v.visibility, ...(v.visibility === 'ring' ? { ring: v.ring } : {}) });
function messagesFor(v: Values, create: boolean): Record<string, string> {
  const body = { url: v.url, title: v.title.trim() || undefined, description: v.description, tags: splitTags(v.tags), pinned: v.pinned, ...shareOf(v) };
  const r = (create ? bookmarkCreateSchema : bookmarkUpdateSchema).safeParse(create ? body : { ...body, title: v.title });
  return fieldMessages(r) ?? {};
}

function BookmarkFields({ v, set, errors, autoFocus }: { v: Values; set: (p: Partial<Values>) => void; errors: Record<string, string>; autoFocus?: boolean }) {
  const t = useT();
  return (
    <>
      <TextField label={t('bookmarks.field.url')} type="url" inputMode="url" value={v.url} onChange={(url) => set({ url })} error={errors.url} autoFocus={autoFocus} />
      <TextField label={t('bookmarks.field.title')} value={v.title} onChange={(title) => set({ title })} error={errors.title} />
      <TextField label={t('bookmarks.field.description')} multiline value={v.description} onChange={(description) => set({ description })} error={errors.description} />
      <TextField label={t('bookmarks.field.tags')} value={v.tags} onChange={(tags) => set({ tags })} error={errors.tags} hint={t('bookmarks.field.tagsHint')} />
      <label className="check"><input type="checkbox" checked={v.pinned} onChange={(e) => set({ pinned: e.target.checked })} /> {t('bookmarks.field.pinned')}</label>
      <WhoSees v={v} set={set} error={errors.ring} />
    </>
  );
}

// Who can see it (docs/21): only me, anyone (the profile and its feed), or the people of one of my rings.
function WhoSees({ v, set, error }: { v: Values; set: (p: Partial<Values>) => void; error?: string }) {
  const t = useT();
  const id = useId();
  const rings = useQuery({ queryKey: ['bookmarks', 'rings'], queryFn: () => api.get<{ rings: { slug: string; name: string }[] }>('/bookmarks/rings') }).data?.rings ?? [];
  const choices: BookmarkVisibility[] = rings.length || v.visibility === 'ring' ? ['private', 'public', 'ring'] : ['private', 'public'];
  return (
    <fieldset className="field who-sees">
      <legend>{t('bookmarks.share.legend')}</legend>
      {choices.map((c) => (
        <label key={c} className="check">
          <input type="radio" name={`${id}-who`} value={c} checked={v.visibility === c}
            onChange={() => set({ visibility: c, ...(c === 'ring' && !v.ring && rings[0] ? { ring: rings[0].slug } : {}) })} />
          {' '}{t(`bookmarks.share.${c}`)}
        </label>
      ))}
      {v.visibility === 'ring' && (
        <div className="field">
          <label htmlFor={`${id}-ring`}>{t('bookmarks.share.whichRing')}</label>
          <select id={`${id}-ring`} value={v.ring} onChange={(e) => set({ ring: e.target.value })} aria-invalid={error ? true : undefined}>
            {!rings.some((r) => r.slug === v.ring) && <option value={v.ring}>{v.ring || '…'}</option>}
            {rings.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
          {error && <p className="field-error">{error}</p>}
        </div>
      )}
      <p className="hint">{t(`bookmarks.share.${v.visibility}Hint`)}</p>
    </fieldset>
  );
}

function EditForm({ b, onDone }: { b: BookmarkView; onDone: () => void }) {
  const t = useT();
  const [v, setV] = useState<Values>({ url: b.url, title: b.title, description: b.description, tags: b.tags.join(' '), pinned: b.pinned, visibility: b.visibility, ring: b.ring?.slug ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.patch(`/bookmarks/${b.id}`, { url: v.url, title: v.title, description: v.description, tags: splitTags(v.tags), pinned: v.pinned, ...shareOf(v) }),
    onSuccess: onDone,
    onError: (e) => setErrors(e instanceof ApiError && e.code === 'duplicate' ? { url: errorText(e) } : { '': errorText(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = messagesFor(v, false);
    setErrors(m);
    if (!Object.keys(m).length) save.mutate();
  };
  return (
    <form className="bookmark-edit" onSubmit={submit} noValidate aria-label={t('bookmarks.editing', { title: b.title })}>
      <BookmarkFields v={v} set={(p) => setV({ ...v, ...p })} errors={errors} autoFocus />
      {errors[''] && <Alert kind="error">{errors['']}</Alert>}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{t('bookmarks.saveChanges')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

// The full form, opened by the bookmarklet, the phone's Share menu or the palette, with what they sent filled in.
// Nothing is saved until the person presses Save.
function AddScreen() {
  const t = useT();
  const nav = useAppNav();
  const qc = useQueryClient();
  const start = prefill(nav.path);
  const [v, setV] = useState<Values>({ url: start.url, title: start.title, description: '', tags: '', pinned: false, visibility: 'private', ring: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ bookmark: BookmarkView; existing: boolean } | null>(null);
  const save = useMutation({
    mutationFn: () => api.post<{ bookmark: BookmarkView; existing: boolean }>('/bookmarks', { url: v.url, ...(v.title.trim() ? { title: v.title.trim() } : {}), ...(v.description.trim() ? { description: v.description } : {}), tags: splitTags(v.tags), pinned: v.pinned, ...shareOf(v) }),
    onSuccess: (r) => { setDone(r); void qc.invalidateQueries({ queryKey: ['bookmarks'] }); },
    onError: (e) => setErrors({ '': errorText(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = messagesFor(v, true);
    setErrors(m);
    if (!Object.keys(m).length) save.mutate();
  };
  // Opened by the bookmarklet as a small window of its own: say it can be closed.
  const popup = typeof window !== 'undefined' && Boolean(window.opener);
  if (done) {
    return (
      <section aria-labelledby="bm-done">
        <h2 id="bm-done">{done.existing ? t('bookmarks.already', { title: done.bookmark.title }) : t('bookmarks.saved', { title: done.bookmark.title })}</h2>
        <p><a href={done.bookmark.url} target="_blank" rel="noopener noreferrer">{done.bookmark.url}</a></p>
        <div className="toolbar">
          {popup ? <button type="button" className="btn btn-primary" onClick={() => window.close()}>{t('bookmarks.closeWindow')}</button> : null}
          <AppLink className="btn" to="">{t('bookmarks.all')}</AppLink>
        </div>
      </section>
    );
  }
  return (
    <section aria-labelledby="bm-add">
      <h2 id="bm-add">{t('bookmarks.addTitle')}</h2>
      <form className="bookmark-edit" onSubmit={submit} noValidate>
        <BookmarkFields v={v} set={(p) => setV({ ...v, ...p })} errors={errors} autoFocus={!start.url} />
        <p className="hint">{t('bookmarks.addHint')}</p>
        {errors[''] && <Alert kind="error">{errors['']}</Alert>}
        <div className="toolbar">
          <button type="submit" className="btn btn-primary" disabled={save.isPending} autoFocus={Boolean(start.url)}>{save.isPending ? t('bookmarks.saving') : t('bookmarks.save')}</button>
          <AppLink className="btn btn-quiet" to="">{t('common.cancel')}</AppLink>
        </div>
      </form>
    </section>
  );
}

// React won't render a javascript: address, so the link gets it after it is drawn.
function Bookmarklet() {
  const t = useT();
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => { ref.current?.setAttribute('href', bookmarkletSource(window.location.origin)); }, []);
  return (
    <details className="bookmarklet">
      <summary>{t('bookmarks.bookmarklet.title')}</summary>
      <p>{t('bookmarks.bookmarklet.how')}</p>
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
      <p><a ref={ref} className="btn" onClick={(e) => e.preventDefault()} draggable>{t('bookmarks.bookmarklet.link')}</a></p>
    </details>
  );
}

// Bring in a bookmarks file from a browser or Linkding (an HTML export). Everything comes in private.
function ImportFile() {
  const t = useT();
  const qc = useQueryClient();
  const [result, setResult] = useState<BookmarkImportResult | null>(null);
  const send = useMutation({
    mutationFn: (file: File) => api.upload<BookmarkImportResult>('/bookmarks/import', file, 'POST'),
    onSuccess: (r) => { setResult(r); void qc.invalidateQueries({ queryKey: ['bookmarks'] }); },
  });
  return (
    <details className="bookmarklet">
      <summary>{t('bookmarks.import.title')}</summary>
      <p>{t('bookmarks.import.how')}</p>
      <div className="field">
        <label htmlFor="bm-import">{t('bookmarks.import.file')}</label>
        <input id="bm-import" type="file" accept=".html,.htm,text/html" disabled={send.isPending}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) { setResult(null); send.mutate(f); } e.target.value = ''; }} />
      </div>
      {send.isPending && <p role="status">{t('bookmarks.import.working')}</p>}
      {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
      {result && (
        <p role="status">
          {t('bookmarks.import.done', { added: result.added, existing: result.existing })}
          {result.invalid > 0 && ` ${t('bookmarks.import.invalid', { count: result.invalid })}`}
          {result.too_many > 0 && ` ${t('bookmarks.import.tooMany', { count: result.too_many })}`}
        </p>
      )}
    </details>
  );
}
