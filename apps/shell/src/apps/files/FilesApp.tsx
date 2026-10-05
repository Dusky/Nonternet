import { useConfirm, undoable } from '../../components/feedback';
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FILE_AREA_VISIBILITIES, FILE_UPLOAD_ROLES, REPORT_CATEGORIES, type FileAreaView, type FileUsage, type FileView } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, BackLink, CopyButton, EmptyState, Loading, NotFound, RelativeTime, TextField } from '../../components/ui';
import { errorText, formatBytes, useMe, useT } from '../../hooks';
import { AppLink, matchRoute, useAppNav } from '../../nav';
import { PersonLink } from '../people/PersonLink';

const ROUTES = ['', ':slug'] as const;

// File areas (docs/05): categories of files anyone can download and trusted people upload to.
export default function FilesApp() {
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  if (!route) return <div className="app-content"><NotFound /></div>;
  return <div className="app-content">{route.pattern === '' ? <Areas /> : <Area slug={route.params.slug!} />}</div>;
}

function Areas() {
  const t = useT();
  const me = useMe().data;
  const q = useQuery({ queryKey: ['files', 'areas', me?.id ?? null], queryFn: () => api.get<{ areas: FileAreaView[] }>('/files') });
  return (
    <>
      <h2>{t('files.areas')}</h2>
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.data && q.data.areas.length === 0 && <EmptyState>{t('files.noAreas')}</EmptyState>}
      {q.isPending && <Loading rows={3} />}
      <ul className="rows">
        {q.data?.areas.map((a) => (
          <li key={a.id}>
            <div className="row-head">
              <span><AppLink to={a.slug} className="board-link"><strong>{a.name}</strong></AppLink>{' '}
                {a.visibility === 'members' && <span className="badge">{t('files.membersOnly')}</span>}{' '}
                {a.archived && <span className="badge">{t('files.archived')}</span>}</span>
            </div>
            {a.description && <p>{a.description}</p>}
            <p className="row-meta">{t('files.count', { count: a.file_count })}{a.last_upload_at ? <> · <RelativeTime iso={a.last_upload_at} /></> : null}</p>
          </li>
        ))}
      </ul>
      {me?.role === 'admin' && <NewArea />}
    </>
  );
}

function NewArea() {
  const t = useT();
  const qc = useQueryClient();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<(typeof FILE_AREA_VISIBILITIES)[number]>('public');
  const [uploadRole, setUploadRole] = useState<(typeof FILE_UPLOAD_ROLES)[number]>('trusted');
  const make = useMutation({
    mutationFn: () => api.post('/admin/files/areas', { slug, name, description, visibility, upload_role: uploadRole }),
    onSuccess: () => { setSlug(''); setName(''); setDescription(''); void qc.invalidateQueries({ queryKey: ['files'] }); },
  });
  return (
    <form className="panel" aria-labelledby="new-area-h" onSubmit={(e) => { e.preventDefault(); make.mutate(); }}>
      <h3 id="new-area-h">{t('files.newArea')}</h3>
      <TextField label={t('files.area.slug')} value={slug} onChange={setSlug} hint={t('files.area.slugHint')} maxLength={32} autoCapitalize="none" spellCheck={false} required />
      <TextField label={t('files.area.name')} value={name} onChange={setName} maxLength={60} required />
      <TextField label={t('files.area.description')} value={description} onChange={setDescription} maxLength={500} multiline />
      <div className="field">
        <label htmlFor="area-vis">{t('files.area.visibility')}</label>
        <select id="area-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
          {FILE_AREA_VISIBILITIES.map((v) => <option key={v} value={v}>{t(`files.visibility.${v}` as StringKey)}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="area-up">{t('files.area.uploadRole')}</label>
        <select id="area-up" value={uploadRole} onChange={(e) => setUploadRole(e.target.value as typeof uploadRole)}>
          {FILE_UPLOAD_ROLES.map((r) => <option key={r} value={r}>{t(`files.uploadRole.${r}` as StringKey)}</option>)}
        </select>
      </div>
      {make.isError && <Alert kind="error">{errorText(make.error)}</Alert>}
      {make.isSuccess && <p role="status" className="hint">{t('files.areaMade')}</p>}
      <button type="submit" className="btn btn-primary" disabled={make.isPending}>{t('files.makeArea')}</button>
    </form>
  );
}

function Area({ slug }: { slug: string }) {
  const t = useT();
  const me = useMe().data;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['files', 'area', slug, me?.id ?? null], queryFn: () => api.get<{ area: FileAreaView; files: FileView[] }>(`/files/areas/${encodeURIComponent(slug)}`) });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.patch(`/admin/files/areas/${slug}`, { archived }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['files'] }),
  });
  const [find, setFind] = useState('');
  const [sort, setSort] = useState<'new' | 'name' | 'size' | 'downloads'>('new');
  const shown = useMemo(() => {
    const needle = find.trim().toLowerCase();
    const list = (q.data?.files ?? []).filter((f) => !needle || `${f.name} ${f.title} ${f.description}`.toLowerCase().includes(needle));
    return list.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      : sort === 'size' ? b.size_bytes - a.size_bytes : sort === 'downloads' ? b.downloads - a.downloads : Date.parse(b.uploaded_at) - Date.parse(a.uploaded_at));
  }, [q.data, find, sort]);
  if (q.isError) return <><BackLink to="">{t('files.back')}</BackLink><Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert></>;
  if (!q.data) return <Loading rows={4} />;
  const { area, files } = q.data;
  return (
    <>
      <BackLink to="">{t('files.back')}</BackLink>
      <h2>{area.name} {area.archived && <span className="badge">{t('files.archived')}</span>}</h2>
      {area.description && <p>{area.description}</p>}
      <p className="hint">{t(`files.uploadRole.${area.upload_role}.who` as StringKey)}</p>
      {files.length > 3 && (
        <div className="toolbar">
          <input type="search" aria-label={t('files.search')} placeholder={t('files.search')} value={find} onChange={(e) => setFind(e.target.value)} />
          <label className="inline">{t('files.sort')}{' '}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              {(['new', 'name', 'size', 'downloads'] as const).map((k) => <option key={k} value={k}>{t(`files.sort.${k}`)}</option>)}
            </select>
          </label>
        </div>
      )}
      {files.length === 0 ? <EmptyState>{t('files.empty')}</EmptyState> : shown.length === 0 ? <EmptyState>{t('files.noMatch')}</EmptyState> : (
        <ul className="rows file-rows">{shown.map((f) => <FileRow key={f.id} f={f} />)}</ul>
      )}
      {area.can_upload && <Upload slug={slug} />}
      {me?.role === 'admin' && (
        <p><button type="button" className="btn btn-quiet" onClick={() => archive.mutate(!area.archived)} disabled={archive.isPending}>{area.archived ? t('files.unarchive') : t('files.archive')}</button></p>
      )}
      {archive.isError && <Alert kind="error">{errorText(archive.error)}</Alert>}
    </>
  );
}

function FileRow({ f }: { f: FileView }) {
  const t = useT();
  const confirm = useConfirm();
  const me = useMe().data;
  const qc = useQueryClient();
  const [tool, setTool] = useState<'report' | 'hide' | 'remove' | null>(null);
  const [editing, setEditing] = useState(false);
  const [gone, setGone] = useState(false); // deleted on screen, waiting out the Undo
  const preview = /\.(png|jpe?g|gif|webp)$/i.test(f.name) && f.size_bytes <= 2_000_000 && !f.hidden;
  const refresh = () => { setTool(null); void qc.invalidateQueries({ queryKey: ['files'] }); };
  const del = useMutation({ mutationFn: (reason?: string) => api.del(`/files/${f.id}`, reason ? { reason } : {}), onSuccess: refresh });
  const hide = useMutation({ mutationFn: (reason: string) => api.post(`/admin/files/${f.id}/${f.hidden ? 'unhide' : 'hide'}`, { reason }), onSuccess: refresh });
  const admin = me?.role === 'admin';
  if (gone) return null;
  return (
    <li>
      <p>
        <a href={f.download_url} download={f.name}><strong>{f.name}</strong></a>{' '}
        <span className="muted">{formatBytes(f.size_bytes)}</span>{' '}
        {f.hidden && <span className="badge badge-warn">{t('files.hidden')}</span>}
      </p>
      {preview && <img className="file-preview" src={f.download_url} alt={f.title || f.name} loading="lazy" />}
      {f.title && <p>{f.title}</p>}
      {f.description && <p className="muted file-description">{f.description}</p>}
      <p className="hint">
        {f.uploader ? <>{t('files.by')} <PersonLink app="people" to={f.uploader.handle}>{f.uploader.handle}</PersonLink> · </> : null}
        <RelativeTime iso={f.uploaded_at} /> · {t('files.downloads', { count: f.downloads })}
      </p>
      <details className="hint"><summary>{t('files.checksum')}</summary><code className="checksum">{f.sha256}</code></details>
      {me && (
        <div className="mod-tools">
          <CopyButton text={new URL(f.download_url, window.location.origin).href} label={t('files.copyLink')} />
          {f.mine && <button type="button" className="link" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>{t('files.edit')}</button>}
          {f.mine && <button type="button" className="link" onClick={() => { setGone(true); undoable(t('files.deleted', { name: f.name }), () => api.del(`/files/${f.id}`, {}).then(refresh), { onUndo: () => setGone(false), onError: () => setGone(false) }); }}>{t('files.delete')}</button>}
          {!f.mine && me.role !== 'guest' && <button type="button" className="link" aria-expanded={tool === 'report'} onClick={() => setTool(tool === 'report' ? null : 'report')}>{t('files.report')}</button>}
          {admin && <button type="button" className="link" onClick={() => setTool('hide')}>{f.hidden ? t('files.unhide') : t('files.hide')}</button>}
          {admin && !f.mine && <button type="button" className="link" onClick={() => setTool('remove')}>{t('files.remove')}</button>}
        </div>
      )}
      {editing && <EditFile f={f} onDone={() => setEditing(false)} />}
      {tool === 'report' && <ReportFile id={f.id} onDone={() => setTool(null)} />}
      {(tool === 'hide' || tool === 'remove') && (
        <ReasonOnly label={tool === 'remove' ? t('files.remove') : f.hidden ? t('files.unhide') : t('files.hide')} pending={hide.isPending || del.isPending}
          error={hide.error ?? del.error} onCancel={() => setTool(null)} onSubmit={(reason) => (tool === 'remove' ? del.mutate(reason) : hide.mutate(reason))} />
      )}
      {del.isError && tool === null && <Alert kind="error">{errorText(del.error)}</Alert>}
    </li>
  );
}

function ReasonOnly({ label, pending, error, onSubmit, onCancel }: { label: string; pending: boolean; error: unknown; onSubmit: (r: string) => void; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <form className="panel" aria-label={label} onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
      <TextField label={t('files.reason')} value={reason} onChange={setReason} maxLength={500} required />
      {error ? <Alert kind="error">{errorText(error)}</Alert> : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>{label}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function ReportFile({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useT();
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('spam');
  const [note, setNote] = useState('');
  const send = useMutation({ mutationFn: () => api.post(`/files/${id}/report`, { category, note }) });
  if (send.isSuccess) return <p className="muted" role="status">{t('files.reported')}</p>;
  return (
    <form className="panel" aria-label={t('files.reportTitle')} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      <div className="field">
        <label htmlFor={`fcat-${id}`}>{t('boards.report.category')}</label>
        <select id={`fcat-${id}`} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`boards.report.cat.${c}`)}</option>)}
        </select>
      </div>
      <TextField label={t('boards.report.note')} value={note} onChange={setNote} maxLength={500} multiline />
      {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={send.isPending}>{t('boards.report.send')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function EditFile({ f, onDone }: { f: FileView; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState(f.title);
  const [description, setDescription] = useState(f.description);
  const save = useMutation({
    mutationFn: () => api.patch(`/files/${f.id}`, { title, description }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['files'] }); onDone(); },
  });
  return (
    <form className="panel" aria-label={t('files.edit')} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <TextField label={t('files.title')} value={title} onChange={setTitle} maxLength={120} />
      <TextField label={t('files.description')} value={description} onChange={setDescription} maxLength={2000} multiline />
      {save.isError && <Alert kind="error">{errorText(save.error)}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{t('edit.save')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

interface QueueItem { file: File; state: 'waiting' | 'sending' | 'done' | 'failed'; progress: number; error?: string }

// Choose or drop one or several files. They go up one at a time, each with its own progress bar.
// Title and description are asked for only when there is a single file.
function Upload({ slug }: { slug: string }) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const usage = useQuery({ queryKey: ['files', 'usage'], queryFn: () => api.get<FileUsage>('/me/files') });
  const u = usage.data;
  const tooBig = (f: File) => Boolean(u && f.size > u.max_file_bytes);
  const pick = (list: FileList | File[] | null) => {
    const files = [...(list ?? [])].slice(0, 20);
    setQueue(files.map((file) => ({ file, state: 'waiting', progress: 0 })));
    setName(files.length === 1 ? files[0]!.name.replace(/\s+/g, '_') : '');
  };
  const patch = (i: number, p: Partial<QueueItem>) => setQueue((q) => q.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const run = async () => {
    setBusy(true);
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      if (item.state === 'done' || tooBig(item.file)) continue;
      patch(i, { state: 'sending', progress: 0, error: undefined });
      try {
        const single = queue.length === 1;
        const p = new URLSearchParams({ name: (single && name) || item.file.name.replace(/\s+/g, '_'), title: single ? title : '', description: single ? description : '' });
        await api.uploadWithProgress<FileView>(`/files/areas/${encodeURIComponent(slug)}/files?${p}`, item.file, (progress) => patch(i, { progress }));
        patch(i, { state: 'done', progress: 1 });
      } catch (e) { patch(i, { state: 'failed', error: errorText(e) }); }
    }
    setBusy(false);
    setTitle(''); setDescription('');
    if (input.current) input.current.value = '';
    void qc.invalidateQueries({ queryKey: ['files'] });
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!busy) pick(e.dataTransfer.files); };
  const sendable = queue.some((x) => x.state !== 'done' && !tooBig(x.file));
  return (
    <form className="panel" aria-labelledby="upload-h" onSubmit={(e: FormEvent) => { e.preventDefault(); if (sendable && !busy) void run(); }}>
      <h3 id="upload-h">{t('files.upload')}</h3>
      {u && <p className="hint">{u.quota_bytes === null ? t('files.usageNoQuota', { used: formatBytes(u.used_bytes), max: formatBytes(u.max_file_bytes) }) : t('files.usage', { used: formatBytes(u.used_bytes), quota: formatBytes(u.quota_bytes), max: formatBytes(u.max_file_bytes) })}</p>}
      <div className={`file-drop${over ? ' is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <label htmlFor="upload-file">{t('files.chooseFile')}</label>
        <input id="upload-file" ref={input} type="file" multiple disabled={busy} onChange={(e) => pick(e.target.files)} />
        <p className="hint">{t('files.dropHint')}</p>
      </div>
      {queue.length > 0 && (
        <ul className="plain upload-queue" aria-label={t('files.queue')}>
          {queue.map((x, i) => (
            <li key={`${x.file.name}-${i}`}>
              <span>{x.file.name} <span className="muted">{formatBytes(x.file.size)}</span></span>{' '}
              {tooBig(x.file) ? <span className="badge badge-warn">{t('files.tooBig', { max: formatBytes(u!.max_file_bytes) })}</span>
                : x.state === 'done' ? <span className="badge">{t('files.uploaded')}</span>
                : x.state === 'failed' ? <span className="badge badge-warn">{x.error}</span>
                : x.state === 'sending' ? <progress max={1} value={x.progress} aria-label={t('files.sending', { name: x.file.name })} /> : null}
            </li>
          ))}
        </ul>
      )}
      {queue.length === 1 && (
        <>
          <TextField label={t('files.name')} value={name} onChange={setName} maxLength={100} hint={t('files.nameHint')} autoCapitalize="none" spellCheck={false} />
          <TextField label={t('files.title')} value={title} onChange={setTitle} maxLength={120} />
          <TextField label={t('files.description')} value={description} onChange={setDescription} maxLength={2000} multiline />
        </>
      )}
      <button type="submit" className="btn btn-primary" disabled={!sendable || busy}>{busy ? t('files.uploading') : t('files.uploadGo')}</button>
    </form>
  );
}
