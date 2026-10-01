import { useConfirm, useToast } from '../../components/feedback';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HomeFileEntry, HomepageSummary, HomeTemplateInfo } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField, Loading, EmptyState, Tabs } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { matchRoute, useAppNav } from '../../nav';
import { CopyButton } from '../../components/ui';

const CodeEditor = lazy(() => import('./CodeEditor'));
interface Mine { homepage: HomepageSummary; files: HomeFileEntry[] }
interface AssetInfo { id: string; title: string; category: string; width: number; height: number }

const ROUTES = ['files', 'assets', 'widgets', 'guestbook', 'domains', 'settings'] as const;
const fmt = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

export default function StudioApp() {
  const t = useT();
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  useEffect(() => { if (!route) nav.go('files', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery({ queryKey: ['studio'], queryFn: () => api.get<Mine>('/homes/me') });
  if (q.isError) return <div className="app-content"><Alert kind="error">{errorText(q.error)}</Alert></div>;
  if (!q.data) return <Loading />;
  const { homepage } = q.data;
  return (
    <div className="app">
      <Tabs label={t('app.studio')} items={[
        { to: 'files', label: t('studio.tab.files') },
        { to: 'assets', label: t('studio.tab.assets') },
        { to: 'widgets', label: t('studio.tab.widgets') },
        { to: 'guestbook', label: t('studio.tab.guestbook') },
        { to: 'domains', label: t('studio.tab.domains') },
        { to: 'settings', label: t('studio.tab.settings') },
      ]} />
      <div className="app-content">
        <Usage h={homepage} />
        {route?.pattern === 'files' && <Files mine={q.data} />}
        {route?.pattern === 'assets' && <Assets />}
        {route?.pattern === 'widgets' && <Widgets />}
        {route?.pattern === 'guestbook' && <GuestbookManager h={homepage} />}
        {route?.pattern === 'domains' && <Domains />}
        {route?.pattern === 'settings' && <Settings h={homepage} />}
      </div>
    </div>
  );
}

function Usage({ h }: { h: HomepageSummary }) {
  const t = useT();
  return (
    <div className="usage">
      <p>
        <a href={h.url} target="_blank" rel="noopener noreferrer">{t('studio.view')}</a>
        {' · '}<span className="muted">{h.last_updated_at ? t('studio.updated', { when: formatWhen(h.last_updated_at) ?? '' }) : t('studio.never')}</span>
      </p>
      <progress value={h.size_bytes} max={h.quota_bytes} aria-label={t('studio.usageLabel')} />
      <p className="hint">{t('studio.usage', { used: fmt(h.size_bytes), quota: fmt(h.quota_bytes) })}</p>
    </div>
  );
}

// ---------------------------------------------------------------- files

function Files({ mine }: { mine: Mine }) {
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

  const uploadAll = async (files: File[]) => {
    setError(null); setNote(null);
    try {
      for (const f of files) await api.upload(`/homes/me/file?path=${encodeURIComponent(folder ? `${folder}/${f.name}` : f.name)}`, f);
      setNote(t('studio.files.uploaded', { count: files.length }));
    } catch (e) { setError(errorText(e)); }
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

// ---------------------------------------------------------------- editor with preview

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

  useEffect(() => {
    let live = true;
    api.get<{ content: string }>(`/homes/me/file?path=${encodeURIComponent(path)}`)
      .then((r) => { if (live) { setText(r.content); saved.current = r.content; latest.current = r.content; } })
      .catch((e) => live && setError(errorText(e)));
    return () => { live = false; };
  }, [path]);

  const save = useCallback(async () => {
    setError(null);
    try {
      await api.upload(`/homes/me/file?path=${encodeURIComponent(path)}`, latest.current);
      saved.current = latest.current; setDirty(false); setStatus(t('studio.edit.saved')); setStamp(Date.now());
    } catch (e) { setError(errorText(e)); }
  }, [path, t]);

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
      {status && !dirty && <p role="status" className="muted">{status}</p>}
      <div className="editor-split">
        {text !== null && (
          <Suspense fallback={<Loading />}>
            <CodeEditor path={path} value={text} label={t('studio.edit.editor', { name: path })}
              onChange={(v) => { latest.current = v; setDirty(v !== saved.current); }} onSave={() => void save()} />
          </Suspense>
        )}
        {previewable && <iframe className="preview-frame" title={t('studio.edit.preview', { name: path })} src={`${url}${path}?v=${stamp}`} />}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- assets and settings

function Assets() {
  const t = useT();
  const qc = useQueryClient();
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['studio', 'assets'], queryFn: () => api.get<{ assets: AssetInfo[] }>('/homes/assets') });
  const add = useMutation({
    mutationFn: (id: string) => api.post<{ path: string }>('/homes/me/assets', { id }),
    onSuccess: (r) => { setAdded(r.path); setError(null); void qc.invalidateQueries({ queryKey: ['studio'] }); }, onError: (e) => setError(errorText(e)),
  });
  return (
    <>
      <p>{t('studio.assets.hint')}</p>
      {error && <Alert kind="error">{error}</Alert>}
      {added && <Alert kind="success">{t('studio.assets.added', { snippet: `<img src="${added}" alt="">` })}</Alert>}
      <ul className="cards asset-grid">
        {list.data?.assets.map((a) => (
          <li key={a.id} className="panel">
            <img src={`/api/v1/homes/assets/${a.id}`} alt="" width={a.width} height={a.height} className="asset-preview" />
            <p>{a.title}</p>
            <button type="button" className="btn" disabled={add.isPending} onClick={() => add.mutate(a.id)} aria-label={t('studio.assets.add', { name: a.title })}>{t('studio.assets.add', { name: a.title })}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Settings({ h }: { h: HomepageSummary }) {
  const t = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState(h.title);
  const [description, setDescription] = useState(h.description);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.patch('/homes/me', { title, description }),
    onSuccess: () => { toast(t('studio.settings.saved')); setError(null); void qc.invalidateQueries({ queryKey: ['studio'] }); }, onError: (e) => setError(errorText(e)),
  });
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <TextField label={t('studio.settings.title')} value={title} onChange={setTitle} maxLength={100} />
      <TextField label={t('studio.settings.description')} hint={t('studio.settings.descriptionHint')} value={description} onChange={setDescription} maxLength={300} multiline />
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={save.isPending}>{t('common.save')}</button>
    </form>
  );
}

// ---------------------------------------------------------------- widgets and guestbook

function Widgets() {
  const t = useT();
  const list = useQuery({ queryKey: ['studio', 'snippets'], queryFn: () => api.get<{ snippets: { id: string; html: string }[] }>('/homes/me/snippets') });
  return (
    <>
      <p>{t('studio.widgets.hint')}</p>
      <ul className="rows">
        {list.data?.snippets.map((s) => (
          <li key={s.id}>
            <strong>{t(`studio.widgets.${s.id}` as 'studio.widgets.guestbook')}</strong>
            {/* Long lines scroll sideways, so the box must take the keyboard focus to be readable without a mouse. */}
            <pre className="terminal" tabIndex={0} role="group" aria-label={t(`studio.widgets.${s.id}` as 'studio.widgets.guestbook')}>{s.html}</pre>
            <CopyButton text={s.html} />
          </li>
        ))}
      </ul>
    </>
  );
}

interface GbRow { id: string; name: string; url: string | null; message: string; at: string; status: 'visible' | 'pending' | 'hidden'; member: string | null }

function GuestbookManager({ h }: { h: HomepageSummary }) {
  const t = useT();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['studio', 'guestbook'], queryFn: () => api.get<{ entries: GbRow[] }>('/homes/me/guestbook') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['studio'] }); };
  const mode = useMutation({ mutationFn: (m: string) => api.patch('/homes/me', { guestbook_mode: m }), onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  const set = useMutation({ mutationFn: (v: { id: string; status: 'visible' | 'hidden' }) => api.patch(`/homes/me/guestbook/${v.id}`, { status: v.status }), onSuccess: refresh, onError: (e) => setError(errorText(e)) });
  return (
    <>
      <div className="field">
        <label htmlFor="gb-mode">{t('studio.guestbook.mode')}</label>
        <select id="gb-mode" value={h.guestbook_mode} onChange={(e) => mode.mutate(e.target.value)}>
          {(['open', 'approval', 'off'] as const).map((m) => <option key={m} value={m}>{t(`studio.guestbook.mode.${m}`)}</option>)}
        </select>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <h2>{t('studio.guestbook.entries')}</h2>
      {list.data?.entries.length === 0 && <EmptyState>{t('studio.guestbook.none')}</EmptyState>}
      <ul className="rows">
        {list.data?.entries.map((e) => (
          <li key={e.id}>
            <strong>{e.name}</strong> <span className="badge">{t(`studio.guestbook.state.${e.status}`)}</span> <span className="muted">{formatWhen(e.at)}</span>
            <p className="post-body">{e.message}</p>
            {e.url && <p className="hint">{e.url}</p>}
            {e.status !== 'visible' && <button type="button" className="link" onClick={() => set.mutate({ id: e.id, status: 'visible' })}>{e.status === 'pending' ? t('studio.guestbook.approve') : t('studio.guestbook.show')}</button>}
            {e.status !== 'hidden' && <button type="button" className="link" onClick={() => set.mutate({ id: e.id, status: 'hidden' })}>{t('studio.guestbook.hide')}</button>}
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------- custom domains

interface DomainInfo {
  domain: string; status: 'pending' | 'verified'; last_error: string | null;
  dns: { txt: { name: string; value: string }; point_to: { type: string; value: string; note: string } };
}

function Domains() {
  const t = useT();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['studio', 'domains'], queryFn: () => api.get<{ domains: DomainInfo[]; max: number }>('/homes/me/domains') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['studio', 'domains'] });
  const add = useMutation({ mutationFn: () => api.post('/homes/me/domains', { domain: name }), onSuccess: () => { setName(''); setError(null); void refresh(); }, onError: (e) => setError(errorText(e)) });
  const remove = useMutation({ mutationFn: (d: string) => api.del(`/homes/me/domains/${encodeURIComponent(d)}`), onSuccess: () => void refresh(), onError: (e) => setError(errorText(e)) });
  const check = useMutation({
    mutationFn: (d: string) => api.post(`/homes/me/domains/${encodeURIComponent(d)}/verify`).then(() => d),
    onSuccess: (d) => { setChecked((c) => ({ ...c, [d]: '' })); void refresh(); },
    onError: (e, d) => { setChecked((c) => ({ ...c, [d]: errorText(e) })); void refresh(); },
  });
  return (
    <>
      <p>{t('studio.domains.hint')}</p>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate(); }}>
        <TextField label={t('studio.domains.name')} hint={t('studio.domains.nameHint')} value={name} onChange={setName} autoCapitalize="none" spellCheck={false} required />
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={add.isPending}>{t('studio.domains.add')}</button>
      </form>
      {list.data?.domains.length === 0 && <EmptyState>{t('studio.domains.none')}</EmptyState>}
      <ul className="rows">
        {list.data?.domains.map((d) => (
          <li key={d.domain}>
            <strong>{d.domain}</strong>{' '}
            <span className={`badge ${d.status === 'verified' ? 'badge-open' : ''}`}>{t(d.status === 'verified' ? 'studio.domains.verified' : 'studio.domains.pending')}</span>
            {d.status === 'verified'
              ? <p>{t('studio.domains.live', { name: d.domain })}</p>
              : (
                <>
                  <p>{t('studio.domains.step1')}</p>
                  <DnsRecord type="TXT" name={d.dns.txt.name} value={d.dns.txt.value} />
                  <p>{t('studio.domains.step2')}</p>
                  <DnsRecord type={d.dns.point_to.type} name={d.domain} value={d.dns.point_to.value} />
                  {d.dns.point_to.note && <p className="hint">{d.dns.point_to.note}</p>}
                  <p className="hint">{t('studio.domains.dnsWait')}</p>
                  {(checked[d.domain] || d.last_error) && <Alert kind="info">{checked[d.domain] || d.last_error}</Alert>}
                  <button type="button" className="btn" onClick={() => check.mutate(d.domain)} disabled={check.isPending}>{t('studio.domains.check', { name: d.domain })}</button>{' '}
                </>
              )}
            <button type="button" className="link" onClick={() => { void confirm({ message: t('studio.domains.removeConfirm', { name: d.domain }), confirmLabel: t('confirm.removeDomain'), danger: true }).then((ok) => ok && remove.mutate(d.domain)); }}>{t('studio.domains.remove', { name: d.domain })}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function DnsRecord({ type, name, value }: { type: string; name: string; value: string }) {
  const t = useT();
  return (
    <dl className="dns">
      <dt>{t('studio.domains.recordType')}</dt><dd>{type}</dd>
      <dt>{t('studio.domains.recordName')}</dt><dd><code>{name}</code> <CopyButton text={name} /></dd>
      <dt>{t('studio.domains.recordValue')}</dt><dd><code>{value}</code> <CopyButton text={value} /></dd>
    </dl>
  );
}
