import type { HomeTemplateInfo } from '@app/shared';
import { useConfirm } from '../../components/feedback';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { Alert, TextField, Loading, EmptyState } from '../../components/ui';
import { clearDraft, loadDraft, saveDraft } from '../../drafts';
import { errorText, useMe, useT } from '../../hooks';
import { Mine, fmt } from './shared';

const CodeEditor = lazy(() => import('./CodeEditor'));

export function Files({ mine }: { mine: Mine }) {
  const t = useT();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [folder, setFolder] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | 'file' | 'folder'>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['studio'] }), [qc]);

  const [sending, setSending] = useState<{ name: string; n: number; of: number; fraction: number } | null>(null);
  const uploadAll = async (files: File[]) => {
    setError(null); setNote(null);
    let done = 0;
    try {
      for (const [i, f] of files.entries()) {
        const path = folder ? `${folder}/${f.name}` : f.name;
        // Ask before replacing something that is already there.
        if (mine.files.some((x) => x.path === path && x.type === 'file')
          && !(await confirm({ message: t('studio.files.overwriteConfirm', { name: path }), confirmLabel: t('studio.files.replace') }))) continue;
        setSending({ name: f.name, n: i + 1, of: files.length, fraction: 0 });
        await api.uploadWithProgress(`/homes/me/file?path=${encodeURIComponent(path)}`, f, (fraction) => setSending((s) => (s ? { ...s, fraction } : s)), 'PUT');
        done++;
      }
      if (done) setNote(t('studio.files.uploaded', { count: done }));
    } catch (e) { setError(errorText(e)); }
    setSending(null);
    void refresh();
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void uploadAll([...e.dataTransfer.files]); };
  const del = useMutation({
    mutationFn: (path: string) => api.del(`/homes/me/file?path=${encodeURIComponent(path)}`),
    onSuccess: () => { setError(null); void refresh(); }, onError: (e) => setError(errorText(e)),
  });
  const move = useMutation({
    mutationFn: (v: { from: string; to: string }) => api.post('/homes/me/move', v),
    onSuccess: () => { setRenaming(null); setError(null); void refresh(); }, onError: (e) => setError(errorText(e)),
  });

  if (editing) return <Editor path={editing} url={mine.homepage.url} onClose={() => { setEditing(null); void refresh(); }} />;
  if (!mine.homepage.has_index) return <Templates onDone={() => void refresh()} />;

  const inFolder = mine.files.filter((f) => (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '') === folder);
  const parts = folder ? folder.split('/') : [];

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
      className={dragging ? 'dropzone is-over' : 'dropzone'}
    >
      <nav aria-label="Folder" className="crumbs">
        <button type="button" className="link" onClick={() => setFolder('')} aria-current={folder === '' ? 'true' : undefined}>{t('studio.files.root')}</button>
        {parts.map((p, i) => (
          <span key={i}> / <button type="button" className="link" onClick={() => setFolder(parts.slice(0, i + 1).join('/'))}>{p}</button></span>
        ))}
      </nav>
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => setAdding('file')}>{t('studio.files.new')}</button>
        <button type="button" className="btn" onClick={() => setAdding('folder')}>{t('studio.files.newFolder')}</button>
        <label className="btn">
          {t('studio.files.upload')}
          <input type="file" multiple className="visually-hidden" onChange={(e) => { void uploadAll([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </label>
      </div>
      <p className="hint">{t('studio.files.drop', { folder: folder || t('studio.files.root') })}</p>
      {adding && (
        <NameForm label={t('studio.files.name')} hint={t('studio.files.nameHint')} submit={t('studio.files.create')} initial=""
          onCancel={() => setAdding(null)}
          onSubmit={async (name) => {
            const path = folder ? `${folder}/${name}` : name;
            try {
              if (adding === 'folder') await api.post('/homes/me/folders', { path });
              else await api.upload(`/homes/me/file?path=${encodeURIComponent(path)}`, '');
              setAdding(null); setError(null); void refresh();
              if (adding === 'file') setEditing(path);
            } catch (e) { setError(errorText(e)); }
          }} />
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {sending && <p role="status">{t('studio.files.sending', { name: sending.name, n: sending.n, of: sending.of })} <progress max={1} value={sending.fraction} aria-label={t('studio.files.sending', { name: sending.name, n: sending.n, of: sending.of })} /></p>}
      {note && <Alert kind="success">{note}</Alert>}
      {inFolder.length === 0 && <EmptyState>{t('studio.files.none')}</EmptyState>}
      <ul className="rows files">
        {inFolder.map((f) => {
          const name = f.path.split('/').pop()!;
          return (
            <li key={f.path}>
              {f.type === 'dir'
                ? <button type="button" className="link" onClick={() => setFolder(f.path)}><span aria-hidden="true">📁 </span>{name}/</button>
                : <strong>{name}</strong>}
              {f.type === 'file' && <span className="muted"> {fmt(f.size)}</span>}
              <span className="file-actions">
                {f.editable && <button type="button" className="link" onClick={() => setEditing(f.path)} aria-label={`${t('studio.files.edit')} ${f.path}`}>{t('studio.files.edit')}</button>}
                {f.type === 'file' && <a href={`${mine.homepage.url}${f.path}`} target="_blank" rel="noopener noreferrer" aria-label={`${t('studio.files.open')} ${f.path}`}>{t('studio.files.open')}</a>}
                <button type="button" className="link" onClick={() => setRenaming(f.path)} aria-label={`${t('studio.files.rename')} ${f.path}`}>{t('studio.files.rename')}</button>
                <button type="button" className="link" aria-label={`${t('studio.files.delete')} ${f.path}`} onClick={() => {
                  void confirm({ message: f.type === 'dir' ? t('studio.files.folderDeleteConfirm', { name: f.path }) : t('studio.files.deleteConfirm', { name: f.path }), confirmLabel: t('confirm.delete'), danger: true }).then((ok) => ok && del.mutate(f.path));
                }}>{t('studio.files.delete')}</button>
              </span>
              {renaming === f.path && (
                <NameForm label={t('studio.files.renameTo')} hint={t('studio.files.nameHint')} submit={t('studio.files.rename')} initial={f.path}
                  onCancel={() => setRenaming(null)} onSubmit={(to) => move.mutate({ from: f.path, to })} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NameForm({ label, hint, submit, initial, onSubmit, onCancel }: { label: string; hint: string; submit: string; initial: string; onSubmit: (v: string) => void; onCancel: () => void }) {
  const t = useT();
  const [v, setV] = useState(initial);
  return (
    <form className="panel" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(v.trim()); }}>
      <TextField label={label} hint={hint} value={v} onChange={setV} autoCapitalize="none" spellCheck={false} required />
      <div className="actions">
        <button type="submit" className="btn btn-primary">{submit}</button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function Templates({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['studio', 'templates'], queryFn: () => api.get<{ templates: HomeTemplateInfo[] }>('/homes/templates') });
  const use = useMutation({
    mutationFn: (id: string) => api.post('/homes/me/template', { template: id }),
    onSuccess: onDone, onError: (e) => setError(errorText(e)),
  });
  return (
    <section aria-labelledby="start-h">
      <h2 id="start-h">{t('studio.start.title')}</h2>
      <p>{t('studio.start.hint')}</p>
      {error && <Alert kind="error">{error}</Alert>}
      <ul className="cards">
        {list.data?.templates.map((tpl) => (
          <li key={tpl.id} className="panel">
            <h3>{tpl.title}</h3>
            <p>{tpl.description}</p>
            <button type="button" className="btn btn-primary" disabled={use.isPending} onClick={() => use.mutate(tpl.id)}>{t('studio.start.use', { name: tpl.title })}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Editor({ path, url, onClose }: { path: string; url: string; onClose: () => void }) {
  const t = useT();
  const confirm = useConfirm();
  const [text, setText] = useState<string | null>(null);
  const saved = useRef('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stamp, setStamp] = useState(() => Date.now());
  const latest = useRef('');
  const me = useMe().data;
  const [restored, setRestored] = useState(false);
  const draftKey = `studio:${path}`;

  // Unsaved changes: ask the browser before the tab goes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    let live = true;
    api.get<{ content: string }>(`/homes/me/file?path=${encodeURIComponent(path)}`)
      .then((r) => {
        if (!live) return;
        saved.current = r.content;
        // A draft from an earlier session (a closed tab, a dropped connection) comes back, marked unsaved.
        const draft = me ? loadDraft(me.id, draftKey) : '';
        const use = draft && draft !== r.content ? draft : r.content;
        latest.current = use;
        setText(use);
        if (use !== r.content) { setDirty(true); setRestored(true); } else if (me) clearDraft(me.id, draftKey);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => { live = false; };
  }, [path]);

  const save = useCallback(async () => {
    setError(null);
    try {
      await api.upload(`/homes/me/file?path=${encodeURIComponent(path)}`, latest.current);
      saved.current = latest.current; setDirty(false); setRestored(false); if (me) clearDraft(me.id, draftKey); setStatus(t('studio.edit.saved')); setStamp(Date.now());
    } catch (e) { setError(errorText(e)); }
  }, [path, t, me, draftKey]);

  const close = () => { if (!dirty) onClose(); else void confirm({ message: t('studio.edit.leave'), confirmLabel: t('confirm.discard'), danger: true }).then((ok) => ok && onClose()); };
  const previewable = /\.(html?|svg|txt|css)$/i.test(path);
  return (
    <section aria-labelledby="edit-h">
      <h2 id="edit-h">{t('studio.edit.title', { name: path })}</h2>
      <div className="toolbar">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty}>{t('studio.edit.save')}</button>
        <button type="button" className="btn" onClick={close}>{t('studio.edit.close')}</button>
        {dirty && <span className="muted" role="status">{t('studio.edit.unsaved')}</span>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {restored && dirty && <p role="status" className="hint">{t('studio.edit.restored')}</p>}
      {status && !dirty && <p role="status" className="muted">{status}</p>}
      <div className="editor-split">
        {text !== null && (
          <Suspense fallback={<Loading />}>
            <CodeEditor path={path} value={text} label={t('studio.edit.editor', { name: path })}
              onChange={(v) => { latest.current = v; setDirty(v !== saved.current); if (me) saveDraft(me.id, draftKey, v === saved.current ? '' : v); }} onSave={() => void save()} />
          </Suspense>
        )}
        {previewable && <iframe className="preview-frame" title={t('studio.edit.preview', { name: path })} src={`${url}${path}?v=${stamp}`} />}
      </div>
    </section>
  );
}
