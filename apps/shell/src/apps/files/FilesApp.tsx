import { useConfirm } from '../../components/feedback';
import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FILE_AREA_VISIBILITIES, FILE_UPLOAD_ROLES, REPORT_CATEGORIES, type FileAreaView, type FileUsage, type FileView } from '@app/shared';
import type { StringKey } from '@app/strings';
import { api } from '../../api';
import { Alert, BackLink, EmptyState, Loading, NotFound, RelativeTime, TextField } from '../../components/ui';
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
  if (q.isError) return <><BackLink to="">{t('files.back')}</BackLink><Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert></>;
  if (!q.data) return <Loading rows={4} />;
  const { area, files } = q.data;
  return (
    <>
      <BackLink to="">{t('files.back')}</BackLink>
      <h2>{area.name} {area.archived && <span className="badge">{t('files.archived')}</span>}</h2>
      {area.description && <p>{area.description}</p>}
      <p className="hint">{t(`files.uploadRole.${area.upload_role}.who` as StringKey)}</p>
      {files.length === 0 ? <EmptyState>{t('files.empty')}</EmptyState> : (
        <ul className="rows file-rows">{files.map((f) => <FileRow key={f.id} f={f} />)}</ul>
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
  const refresh = () => { setTool(null); void qc.invalidateQueries({ queryKey: ['files'] }); };
  const del = useMutation({ mutationFn: (reason?: string) => api.del(`/files/${f.id}`, reason ? { reason } : {}), onSuccess: refresh });
  const hide = useMutation({ mutationFn: (reason: string) => api.post(`/admin/files/${f.id}/${f.hidden ? 'unhide' : 'hide'}`, { reason }), onSuccess: refresh });
  const admin = me?.role === 'admin';
  return (
    <li>
      <p>
        <a href={f.download_url} download={f.name}><strong>{f.name}</strong></a>{' '}
        <span className="muted">{formatBytes(f.size_bytes)}</span>{' '}
        {f.hidden && <span className="badge badge-warn">{t('files.hidden')}</span>}
      </p>
      {f.title && <p>{f.title}</p>}
      {f.description && <p className="muted file-description">{f.description}</p>}
      <p className="hint">
        {f.uploader ? <>{t('files.by')} <PersonLink app="people" to={f.uploader.handle}>{f.uploader.handle}</PersonLink> · </> : null}
        <RelativeTime iso={f.uploaded_at} /> · {t('files.downloads', { count: f.downloads })}
      </p>
      <details className="hint"><summary>{t('files.checksum')}</summary><code className="checksum">{f.sha256}</code></details>
      {me && (
        <div className="mod-tools">
          {f.mine && <button type="button" className="link" onClick={() => { void confirm({ message: t('files.deleteConfirm', { name: f.name }), confirmLabel: t('confirm.delete'), danger: true }).then((ok) => ok && del.mutate(undefined)); }}>{t('files.delete')}</button>}
          {!f.mine && me.role !== 'guest' && <button type="button" className="link" aria-expanded={tool === 'report'} onClick={() => setTool(tool === 'report' ? null : 'report')}>{t('files.report')}</button>}
          {admin && <button type="button" className="link" onClick={() => setTool('hide')}>{f.hidden ? t('files.unhide') : t('files.hide')}</button>}
          {admin && !f.mine && <button type="button" className="link" onClick={() => setTool('remove')}>{t('files.remove')}</button>}
        </div>
      )}
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

function Upload({ slug }: { slug: string }) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const usage = useQuery({ queryKey: ['files', 'usage'], queryFn: () => api.get<FileUsage>('/me/files') });
  const send = useMutation({
    mutationFn: () => {
      const p = new URLSearchParams({ name: name || file!.name, title, description });
      return api.upload<FileView>(`/files/areas/${encodeURIComponent(slug)}/files?${p}`, file!, 'POST');
    },
    onSuccess: () => {
      setFile(null); setName(''); setTitle(''); setDescription('');
      if (input.current) input.current.value = '';
      void qc.invalidateQueries({ queryKey: ['files'] });
    },
  });
  const u = usage.data;
  const tooBig = Boolean(file && u && file.size > u.max_file_bytes);
  const submit = (e: FormEvent) => { e.preventDefault(); if (file && !tooBig) send.mutate(); };
  return (
    <form className="panel" aria-labelledby="upload-h" onSubmit={submit}>
      <h3 id="upload-h">{t('files.upload')}</h3>
      {u && <p className="hint">{u.quota_bytes === null ? t('files.usageNoQuota', { used: formatBytes(u.used_bytes), max: formatBytes(u.max_file_bytes) }) : t('files.usage', { used: formatBytes(u.used_bytes), quota: formatBytes(u.quota_bytes), max: formatBytes(u.max_file_bytes) })}</p>}
      <div className="field">
        <label htmlFor="upload-file">{t('files.chooseFile')}</label>
        <input id="upload-file" ref={input} type="file" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setName(f ? f.name.replace(/\s+/g, '_') : ''); }} />
      </div>
      {tooBig && <Alert kind="error">{t('files.tooBig', { max: formatBytes(u!.max_file_bytes) })}</Alert>}
      <TextField label={t('files.name')} value={name} onChange={setName} maxLength={100} hint={t('files.nameHint')} autoCapitalize="none" spellCheck={false} />
      <TextField label={t('files.title')} value={title} onChange={setTitle} maxLength={120} />
      <TextField label={t('files.description')} value={description} onChange={setDescription} maxLength={2000} multiline />
      {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
      {send.isSuccess && <p role="status" className="hint">{t('files.uploaded')}</p>}
      <button type="submit" className="btn btn-primary" disabled={!file || tooBig || send.isPending}>{send.isPending ? t('files.uploading') : t('files.uploadGo')}</button>
    </form>
  );
}
