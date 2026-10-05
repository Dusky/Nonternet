import { FeedLink } from '../../components/FeedLink';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { diffLines } from 'diff';
import { REPORT_CATEGORIES, WIKI_SUMMARY_MAX, WIKI_TITLE_MAX, wikiSlug, type WikiChange, type WikiInfo, type WikiPageSummary, type WikiPageView, type WikiRevisionView, type WikiSearchHit } from '@app/shared';
import { api, ApiError } from '../../api';
import { clearDraft, loadDraft } from '../../drafts';
import { Editor } from '../../components/Editor';
import { toast } from '../../components/feedback';
import { HelpTip } from '../../components/HelpTip';
import { MenuButton, type MenuEntry } from '../../components/Menu';
import { Alert, BackLink, EmptyState, Loading, NotFound, RelativeTime, TextField } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { AppLink, useAppNav } from '../../nav';
import { PersonLink } from '../people/PersonLink';
import { WikiText } from './WikiText';

// The wiki (docs/20): the site's, at the app's root, and a ring's under r/{ring}/. Pages, editing with a live preview,
// history and comparison, recent changes, all pages, wanted pages, search and "what links here".

interface Where { ref: string; base: string; rest: string[] }
function where(path: string): Where {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'r' && parts[1]) return { ref: `ring:${parts[1]}`, base: `r/${parts[1]}/`, rest: parts.slice(2) };
  return { ref: 'site', base: '', rest: parts };
}
const W = (ref: string) => `/wiki/${encodeURIComponent(ref)}`;
const P = (ref: string, slug: string) => `${W(ref)}/pages/${encodeURIComponent(slug)}`;

export default function WikiApp() {
  const nav = useAppNav();
  const w = where(nav.path);
  const info = useQuery({ queryKey: ['wiki', w.ref, 'info'], queryFn: () => api.get<WikiInfo>(W(w.ref)) });
  if (info.isError) return <div className="app-content">{info.error instanceof ApiError && info.error.status === 404 ? <NotFound /> : <Alert kind="error" retry={() => void info.refetch()}>{errorText(info.error)}</Alert>}</div>;
  if (!info.data) return <div className="app-content"><Loading rows={4} /></div>;
  const [a, slug, b, x, y] = w.rest;
  const props = { info: info.data, base: w.base };
  let screen;
  if (!a) screen = <PageScreen {...props} slug="home" home />;
  else if (a === 'p' && slug && !b) screen = <PageScreen {...props} slug={slug} />;
  else if (a === 'p' && slug && b === 'edit') screen = <EditScreen {...props} slug={slug} />;
  else if (a === 'p' && slug && b === 'history') screen = <History {...props} slug={slug} />;
  else if (a === 'p' && slug && b === 'rev' && x) screen = <RevisionScreen {...props} slug={slug} revision={Number(x)} />;
  else if (a === 'p' && slug && b === 'compare' && x && y) screen = <Compare {...props} slug={slug} from={Number(x)} to={Number(y)} />;
  else if (a === 'p' && slug && b === 'links') screen = <LinksHere {...props} slug={slug} />;
  else if (a === 'changes') screen = <Changes {...props} />;
  else if (a === 'pages') screen = <AllPages {...props} />;
  else if (a === 'wanted') screen = <Wanted {...props} />;
  else if (a === 'search') screen = <Search {...props} />;
  else screen = <NotFound />;
  return <div className="app-content wiki">{<WikiBar {...props} />}{screen}</div>;
}

type Props = { info: WikiInfo; base: string };

function WikiBar({ info, base }: Props) {
  const t = useT();
  return (
    <nav className="wiki-bar" aria-label={t('wiki.nav')}>
      <strong>{info.ring ? t('wiki.ofRing', { name: info.ring.name }) : t('wiki.title')}</strong>
      <AppLink to={base || ''}>{t('wiki.home')}</AppLink>
      <AppLink to={`${base}pages`}>{t('wiki.allPages')}</AppLink>
      <AppLink to={`${base}changes`}>{t('wiki.changes')}</AppLink>
      <AppLink to={`${base}wanted`}>{t('wiki.wanted')}</AppLink>
      <AppLink to={`${base}search`}>{t('wiki.search')}</AppLink>
    </nav>
  );
}

const usePage = (ref: string, slug: string) => useQuery({ queryKey: ['wiki', ref, 'page', slug], queryFn: () => api.get<WikiPageView>(P(ref, slug)), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
const missing = (e: unknown) => e instanceof ApiError && e.status === 404;
// "getting-started" -> "Getting started": a starting title for a page someone links to before it exists.
const titleFromSlug = (slug: string) => { const s = slug.replace(/-/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };

function PageScreen({ info, base, slug, home }: Props & { slug: string; home?: boolean }) {
  const t = useT();
  const me = useMe().data;
  const q = usePage(info.ref, slug);
  const [tool, setTool] = useState<null | 'rename' | 'report' | 'hide' | 'delete'>(null);
  if (q.isPending) return <Loading rows={6} />;
  if (q.isError && missing(q.error)) {
    return (
      <EmptyState art="notebook" action={info.can_edit ? <AppLink className="btn btn-primary" to={`${base}p/${slug}/edit`}>{home ? t('wiki.startFirst') : t('wiki.startThis')}</AppLink> : undefined}>
        {home ? t('wiki.empty') : t('wiki.noSuchPage', { name: titleFromSlug(slug) })}
      </EmptyState>
    );
  }
  if (q.isError) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const p = q.data;
  const known = new Map(p.links.map((l) => [l.slug, l.exists]));
  return (
    <article aria-labelledby="wiki-title">
      <h2 id="wiki-title">{p.title} {p.protected && <span className="badge">{t('wiki.protected')}</span>} {p.hidden && <span className="badge">{t('wiki.hidden')}</span>} {p.deleted && <span className="badge">{t('wiki.deleted')}</span>}</h2>
      {p.redirected_from && <p className="hint">{t('wiki.redirectedFrom', { name: titleFromSlug(p.redirected_from) })}</p>}
      <p className="row-meta">
        {t('wiki.revision', { n: p.revision })} · {p.updated_by ? <PersonLink app="people" to={p.updated_by.handle}>@{p.updated_by.handle}</PersonLink> : t('wiki.someone')} · <RelativeTime iso={p.updated_at} />
      </p>
      <div className="toolbar">
        {p.can_edit && <AppLink className="btn btn-primary" to={`${base}p/${p.slug}/edit`}>{t('wiki.edit')}</AppLink>}
        <AppLink className="btn btn-quiet" to={`${base}p/${p.slug}/history`}>{t('wiki.history')}</AppLink>
        <AppLink className="btn btn-quiet" to={`${base}p/${p.slug}/links`}>{t('wiki.linksHere')}</AppLink>
        {p.can_edit && <button type="button" className="btn btn-quiet" onClick={() => setTool('rename')}>{t('wiki.rename')}</button>}
        {me && !info.can_moderate && <button type="button" className="btn btn-quiet" onClick={() => setTool('report')}>{t('wiki.report')}</button>}
        {info.can_moderate && <ModTools info={info} page={p} open={setTool} />}
      </div>
      {tool === 'rename' && <Rename info={info} base={base} page={p} done={() => setTool(null)} />}
      {tool === 'report' && <Report info={info} page={p} done={() => setTool(null)} />}
      {(tool === 'hide' || tool === 'delete') && <WithReason info={info} page={p} action={tool} done={() => setTool(null)} />}
      <WikiText body={p.body} base={base} exists={(s) => known.get(s) ?? false} />
    </article>
  );
}

function ModTools({ info, page, open }: { info: WikiInfo; page: WikiPageView; open: (t: 'hide' | 'delete') => void }) {
  const t = useT();
  const qc = useQueryClient();
  const act = (action: string) => api.post<WikiPageView>(`${P(info.ref, page.slug)}/${action}`, {}).then((p) => { qc.setQueryData(['wiki', info.ref, 'page', page.slug], p); void qc.invalidateQueries({ queryKey: ['wiki', info.ref] }); }).catch((e) => toast(errorText(e), 'error'));
  const items: MenuEntry[] = [
    { label: page.protected ? t('wiki.unprotect') : t('wiki.protect'), onSelect: () => void act(page.protected ? 'unprotect' : 'protect') },
    page.hidden ? { label: t('wiki.unhide'), onSelect: () => void act('unhide') } : { label: t('wiki.hide'), onSelect: () => open('hide') },
    page.deleted ? { label: t('wiki.restore'), onSelect: () => void act('restore') } : { label: t('wiki.delete'), danger: true, onSelect: () => open('delete') },
  ];
  return <MenuButton label={t('wiki.modTools')} items={items} />;
}

function WithReason({ info, page, action, done }: { info: WikiInfo; page: WikiPageView; action: 'hide' | 'delete'; done: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const go = useMutation({
    mutationFn: () => api.post<WikiPageView>(`${P(info.ref, page.slug)}/${action}`, { reason }),
    onSuccess: (p) => { qc.setQueryData(['wiki', info.ref, 'page', page.slug], p); void qc.invalidateQueries({ queryKey: ['wiki', info.ref] }); done(); },
  });
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
      <TextField label={action === 'hide' ? t('wiki.hideWhy') : t('wiki.deleteWhy')} value={reason} onChange={setReason} maxLength={500} required autoFocus />
      {go.isError && <Alert kind="error">{errorText(go.error)}</Alert>}
      <div className="toolbar">
        <button type="submit" className={`btn ${action === 'delete' ? 'btn-danger' : 'btn-primary'}`} disabled={go.isPending || reason.trim().length < 3}>{action === 'hide' ? t('wiki.hide') : t('wiki.delete')}</button>
        <button type="button" className="btn btn-quiet" onClick={done}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function Rename({ info, base, page, done }: { info: WikiInfo; base: string; page: WikiPageView; done: () => void }) {
  const t = useT();
  const nav = useAppNav();
  const qc = useQueryClient();
  const [title, setTitle] = useState(page.title);
  const go = useMutation({
    mutationFn: () => api.post<WikiPageView>(`${P(info.ref, page.slug)}/rename`, { title, base_revision: page.revision }),
    onSuccess: (p) => { void qc.invalidateQueries({ queryKey: ['wiki', info.ref] }); done(); nav.go(`${base}p/${p.slug}`, { replace: true }); },
  });
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
      <TextField label={t('wiki.newName')} value={title} onChange={setTitle} maxLength={WIKI_TITLE_MAX} hint={t('wiki.renameHint')} required autoFocus />
      {go.isError && <Alert kind="error">{errorText(go.error)}</Alert>}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={go.isPending || !wikiSlug(title) || title.trim() === page.title}>{t('wiki.rename')}</button>
        <button type="button" className="btn btn-quiet" onClick={done}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

function Report({ info, page, done }: { info: WikiInfo; page: WikiPageView; done: () => void }) {
  const t = useT();
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('spam');
  const [note, setNote] = useState('');
  const go = useMutation({ mutationFn: () => api.post(`${P(info.ref, page.slug)}/report`, { category, note }), onSuccess: () => { toast(t('wiki.reported')); done(); } });
  return (
    <form className="panel" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
      <div className="field">
        <label htmlFor="wiki-report-cat">{t('boards.report.category')}</label>
        <select id="wiki-report-cat" value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
          {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`boards.report.cat.${c}`)}</option>)}
        </select>
      </div>
      <TextField label={t('boards.report.note')} value={note} onChange={setNote} maxLength={500} multiline />
      {go.isError && <Alert kind="error">{errorText(go.error)}</Alert>}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={go.isPending}>{t('wiki.sendReport')}</button>
        <button type="button" className="btn btn-quiet" onClick={done}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

// Writing a page, with the preview beside it. A save that started from an older revision comes back with the
// current text; both are shown so the person can merge by hand, and their own words are never thrown away.
function EditScreen({ info, base, slug }: Props & { slug: string }) {
  const t = useT();
  const nav = useAppNav();
  const qc = useQueryClient();
  const me = useMe().data;
  const q = usePage(info.ref, slug);
  if (q.isPending) return <Loading rows={6} />;
  if (q.isError && !missing(q.error)) return <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>;
  const page = q.data ?? null;
  if (!info.can_edit || (page && !page.can_edit)) return <Alert kind="info">{page?.protected ? t('wiki.protectedNote') : t('wiki.cantEdit')}</Alert>;
  return <EditForm key={`${slug}:${page?.revision ?? 0}`} info={info} base={base} slug={slug} page={page} user={me?.id ?? ''} onSaved={(p) => {
    qc.setQueryData(['wiki', info.ref, 'page', p.slug], p);
    void qc.invalidateQueries({ queryKey: ['wiki', info.ref] });
    nav.go(`${base}p/${p.slug}`);
  }} />;
}

function EditForm({ info, base, slug, page, user, onSaved }: { info: WikiInfo; base: string; slug: string; page: WikiPageView | null; user: string; onSaved: (p: WikiPageView) => void }) {
  const t = useT();
  const draftKey = `wiki:${info.ref}:${slug}`;
  const [title, setTitle] = useState(page?.title ?? titleFromSlug(slug));
  const [body, setBody] = useState(() => (user && loadDraft(user, draftKey)) || page?.body || '');
  const [summary, setSummary] = useState('');
  const [base_revision, setBase] = useState(page?.revision ?? 0);
  const [theirs, setTheirs] = useState<WikiPageView | null>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const titleOk = wikiSlug(title) === slug;
  const save = useMutation({
    mutationFn: () => api.put<WikiPageView>(P(info.ref, slug), { title, body, base_revision, summary }),
    onSuccess: (p) => { if (user) clearDraft(user, draftKey); toast(t('wiki.saved')); onSaved(p); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'edit_conflict') {
        const current = (e.details.current as WikiPageView | undefined) ?? null;
        if (current) { setTheirs(current); setBase(current.revision); }
      }
    },
  });
  const known = new Set((theirs ?? page)?.links.filter((l) => l.exists).map((l) => l.slug) ?? []);
  const submit = (e?: FormEvent) => { e?.preventDefault(); if (titleOk && body.trim()) save.mutate(); };
  return (
    <form onSubmit={submit} aria-labelledby="wiki-edit-h">
      <h2 id="wiki-edit-h">{page ? t('wiki.editing', { name: page.title }) : t('wiki.newPage')}</h2>
      {page && <BackLink to={`${base}p/${slug}`}>{t('wiki.backToPage')}</BackLink>}
      {theirs && (
        <section className="panel wiki-conflict" aria-labelledby="wiki-conflict-h">
          <h3 id="wiki-conflict-h">{t('wiki.conflictTitle')}</h3>
          <p>{t('wiki.conflictBody', { who: theirs.updated_by?.handle ?? t('wiki.someone') })}</p>
          <details open>
            <summary>{t('wiki.theirVersion', { n: theirs.revision })}</summary>
            <pre className="wiki-source">{theirs.body}</pre>
          </details>
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(body); toast(t('wiki.copiedYours')); }}>{t('wiki.copyYours')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setBody(theirs.body); }}>{t('wiki.startFromTheirs')}</button>
          </div>
        </section>
      )}
      {!page && <TextField label={t('wiki.pageTitle')} value={title} onChange={setTitle} maxLength={WIKI_TITLE_MAX} error={titleOk ? undefined : t('wiki.titleOtherPage')} required />}
      <div className="wiki-tabs toolbar" role="group" aria-label={t('wiki.view')}>
        <button type="button" className="btn btn-quiet" aria-pressed={tab === 'write'} onClick={() => setTab('write')}>{t('wiki.write')}</button>
        <button type="button" className="btn btn-quiet" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>{t('wiki.preview')}</button>
        <HelpTip topic={t('wiki.markupHelpTopic')}>
          <p>{t('wiki.markupHelp1')}</p>
          <pre className="wiki-source">{t('wiki.markupHelp2')}</pre>
        </HelpTip>
      </div>
      <div className={`wiki-editor is-${tab}`}>
        <div className="wiki-write">
          <Editor label={t('wiki.text')} value={body} onChange={setBody} draftKey={user ? draftKey : undefined} rows={18} mono onSubmit={() => submit()} />
        </div>
        <section className="wiki-preview" aria-label={t('wiki.preview')}>
          <WikiText body={body} base={base} exists={(s) => known.has(s) || s === slug} />
        </section>
      </div>
      <TextField label={t('wiki.summary')} value={summary} onChange={setSummary} maxLength={WIKI_SUMMARY_MAX} hint={t('wiki.summaryHint')} />
      {save.isError && !theirs && <Alert kind="error">{errorText(save.error)}</Alert>}
      <button type="submit" className="btn btn-primary" disabled={save.isPending || !titleOk || !body.trim()}>{save.isPending ? t('common.working') : t('wiki.save')}</button>
    </form>
  );
}

function History({ info, base, slug }: Props & { slug: string }) {
  const t = useT();
  const qc = useQueryClient();
  const page = usePage(info.ref, slug);
  const q = useQuery({ queryKey: ['wiki', info.ref, 'history', slug], queryFn: () => api.get<{ revisions: WikiRevisionView[] }>(`${P(info.ref, slug)}/history`) });
  const [hiding, setHiding] = useState<number | null>(null);
  const restore = useMutation({
    mutationFn: (n: number) => api.post<WikiPageView>(`${P(info.ref, slug)}/revert`, { revision: n, base_revision: page.data!.revision }),
    onSuccess: (p) => { toast(t('wiki.restored', { n: p.revision })); void qc.invalidateQueries({ queryKey: ['wiki', info.ref] }); },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const show = (n: number) => api.post(`${P(info.ref, slug)}/revisions/${n}/show`, { reason: 'shown again' }).then(() => qc.invalidateQueries({ queryKey: ['wiki', info.ref, 'history', slug] })).catch((e) => toast(errorText(e), 'error'));
  return (
    <section aria-labelledby="wiki-hist-h">
      <BackLink to={`${base}p/${slug}`}>{t('wiki.backToPage')}</BackLink>
      <h2 id="wiki-hist-h">{t('wiki.historyOf', { name: page.data?.title ?? titleFromSlug(slug) })}</h2>
      {q.isPending && <Loading rows={4} />}
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      <ol className="rows wiki-history" reversed>
        {q.data?.revisions.map((r) => (
          <li key={r.id}>
            <div className="row-head">
              <span><AppLink to={`${base}p/${slug}/rev/${r.revision}`}><strong>{t('wiki.revision', { n: r.revision })}</strong></AppLink>{' '}
                {r.revision === page.data?.revision && <span className="badge">{t('wiki.current')}</span>}
                {r.text_hidden && <span className="badge">{t('wiki.textHidden')}</span>}</span>
              <span className="row-meta">{r.editor ? <PersonLink app="people" to={r.editor.handle}>@{r.editor.handle}</PersonLink> : t('wiki.deletedAccount')} · <RelativeTime iso={r.created_at} /></span>
            </div>
            {r.summary && <p>{r.summary}</p>}
            <div className="toolbar">
              {r.revision > 1 && <AppLink className="btn btn-quiet btn-small" to={`${base}p/${slug}/compare/${r.revision - 1}/${r.revision}`}>{t('wiki.compareWithPrevious')}</AppLink>}
              {page.data?.can_edit && r.revision !== page.data.revision && !r.text_hidden && <button type="button" className="btn btn-quiet btn-small" disabled={restore.isPending} onClick={() => restore.mutate(r.revision)}>{t('wiki.restoreThis')}</button>}
              {info.can_moderate && r.revision !== page.data?.revision && (r.text_hidden
                ? <button type="button" className="btn btn-quiet btn-small" onClick={() => void show(r.revision)}>{t('wiki.showText')}</button>
                : <button type="button" className="btn btn-quiet btn-small" onClick={() => setHiding(r.revision)}>{t('wiki.hideText')}</button>)}
            </div>
            {hiding === r.revision && <HideRevision info={info} slug={slug} revision={r.revision} done={() => setHiding(null)} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function HideRevision({ info, slug, revision, done }: { info: WikiInfo; slug: string; revision: number; done: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const go = useMutation({ mutationFn: () => api.post(`${P(info.ref, slug)}/revisions/${revision}/hide`, { reason }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['wiki', info.ref, 'history', slug] }); done(); } });
  return (
    <form onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
      <TextField label={t('wiki.hideTextWhy')} value={reason} onChange={setReason} maxLength={500} required autoFocus />
      {go.isError && <Alert kind="error">{errorText(go.error)}</Alert>}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary" disabled={go.isPending || reason.trim().length < 3}>{t('wiki.hideText')}</button>
        <button type="button" className="btn btn-quiet" onClick={done}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

const useRevision = (ref: string, slug: string, n: number) => useQuery({ queryKey: ['wiki', ref, 'rev', slug, n], queryFn: () => api.get<WikiRevisionView>(`${P(ref, slug)}/revisions/${n}`), enabled: n > 0 });

function RevisionScreen({ info, base, slug, revision }: Props & { slug: string; revision: number }) {
  const t = useT();
  const page = usePage(info.ref, slug);
  const r = useRevision(info.ref, slug, revision);
  const known = new Map(page.data?.links.map((l) => [l.slug, l.exists]) ?? []);
  return (
    <article aria-labelledby="wiki-rev-h">
      <BackLink to={`${base}p/${slug}/history`}>{t('wiki.backToHistory')}</BackLink>
      <h2 id="wiki-rev-h">{r.data?.title ?? titleFromSlug(slug)} <span className="badge">{t('wiki.revision', { n: revision })}</span></h2>
      {r.isPending && <Loading rows={4} />}
      {r.isError && <Alert kind="error">{errorText(r.error)}</Alert>}
      {r.data && <p className="row-meta">{r.data.editor ? `@${r.data.editor.handle}` : t('wiki.deletedAccount')} · <RelativeTime iso={r.data.created_at} />{r.data.summary ? ` · ${r.data.summary}` : ''}</p>}
      {r.data && (r.data.body === null ? <Alert kind="info">{t('wiki.textHiddenNote')}</Alert> : <WikiText body={r.data.body} base={base} exists={(s) => known.get(s) ?? false} />)}
    </article>
  );
}

// Two revisions, line by line. Added and removed lines are marked with words and a sign as well as colour.
function Compare({ info, base, slug, from, to }: Props & { slug: string; from: number; to: number }) {
  const t = useT();
  const a = useRevision(info.ref, slug, from);
  const b = useRevision(info.ref, slug, to);
  const ready = a.data && b.data;
  const hidden = ready && (a.data!.body === null || b.data!.body === null);
  const parts = ready && !hidden ? diffLines(a.data!.body!, b.data!.body!) : [];
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.count ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
  return (
    <section aria-labelledby="wiki-cmp-h">
      <BackLink to={`${base}p/${slug}/history`}>{t('wiki.backToHistory')}</BackLink>
      <h2 id="wiki-cmp-h">{t('wiki.comparing', { a: from, b: to })}</h2>
      {(a.isPending || b.isPending) && <Loading rows={4} />}
      {(a.isError || b.isError) && <Alert kind="error">{errorText(a.error ?? b.error)}</Alert>}
      {hidden && <Alert kind="info">{t('wiki.textHiddenNote')}</Alert>}
      {ready && !hidden && (
        <>
          <p className="row-meta">{t('wiki.diffCount', { added, removed })}{b.data!.summary ? ` · ${b.data!.summary}` : ''}</p>
          {a.data!.title !== b.data!.title && <p>{t('wiki.titleChanged', { a: a.data!.title, b: b.data!.title })}</p>}
          <ol className="wiki-diff" aria-label={t('wiki.changesList')}>
            {parts.flatMap((p, i) => p.value.replace(/\n$/, '').split('\n').map((line, j) => (
              <li key={`${i}-${j}`} className={p.added ? 'is-added' : p.removed ? 'is-removed' : 'is-same'}>
                <span className="wiki-diff-sign" aria-hidden="true">{p.added ? '+' : p.removed ? '−' : ' '}</span>
                {(p.added || p.removed) && <span className="visually-hidden">{p.added ? t('wiki.added') : t('wiki.removed')}: </span>}
                <span>{line || ' '}</span>
              </li>
            )))}
          </ol>
          {added === 0 && removed === 0 && <p>{t('wiki.noTextChange')}</p>}
        </>
      )}
    </section>
  );
}

function LinksHere({ info, base, slug }: Props & { slug: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['wiki', info.ref, 'links', slug], queryFn: () => api.get<{ pages: WikiPageSummary[] }>(`${P(info.ref, slug)}/links-here`) });
  return (
    <section aria-labelledby="wiki-links-h">
      <BackLink to={`${base}p/${slug}`}>{t('wiki.backToPage')}</BackLink>
      <h2 id="wiki-links-h">{t('wiki.linksHereTitle', { name: titleFromSlug(slug) })}</h2>
      {q.isPending && <Loading rows={3} />}
      {q.data && q.data.pages.length === 0 && <EmptyState>{t('wiki.noLinksHere')}</EmptyState>}
      <ul className="rows">{q.data?.pages.map((p) => <li key={p.slug}><AppLink to={`${base}p/${p.slug}`}>{p.title}</AppLink></li>)}</ul>
    </section>
  );
}

function Changes({ info, base }: Props) {
  const t = useT();
  const q = useQuery({ queryKey: ['wiki', info.ref, 'changes'], queryFn: () => api.get<{ changes: WikiChange[] }>(`${W(info.ref)}/changes`) });
  return (
    <section aria-labelledby="wiki-changes-h">
      <h2 id="wiki-changes-h">{t('wiki.changes')}</h2>
      <p className="toolbar"><FeedLink href={info.ring ? `/feeds/wiki/rings/${info.ring.slug}/changes.atom` : '/feeds/wiki/changes.atom'} title={t('wiki.changes')} /></p>
      {q.isPending && <Loading rows={5} />}
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.data && q.data.changes.length === 0 && <EmptyState>{t('wiki.noChanges')}</EmptyState>}
      <ul className="rows">
        {q.data?.changes.map((c) => (
          <li key={`${c.page.slug}-${c.revision}`}>
            <div className="row-head">
              <span><AppLink to={`${base}p/${c.page.slug}`}><strong>{c.page.title}</strong></AppLink>{' '}{c.created && <span className="badge">{t('wiki.newPageBadge')}</span>}</span>
              <span className="row-meta">{c.editor ? `@${c.editor.handle}` : t('wiki.deletedAccount')} · <RelativeTime iso={c.created_at} /></span>
            </div>
            {c.summary && <p>{c.summary}</p>}
            {!c.created && <AppLink className="row-meta" to={`${base}p/${c.page.slug}/compare/${c.revision - 1}/${c.revision}`}>{t('wiki.whatChanged')}</AppLink>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AllPages({ info, base }: Props) {
  const t = useT();
  const q = useQuery({ queryKey: ['wiki', info.ref, 'pages'], queryFn: () => api.get<{ pages: WikiPageSummary[] }>(`${W(info.ref)}/pages`) });
  return (
    <section aria-labelledby="wiki-pages-h">
      <h2 id="wiki-pages-h">{t('wiki.allPages')}</h2>
      {q.isPending && <Loading rows={5} />}
      {q.data && q.data.pages.length === 0 && <EmptyState art="notebook">{t('wiki.empty')}</EmptyState>}
      <ul className="rows wiki-index">{q.data?.pages.map((p) => <li key={p.slug}><AppLink to={`${base}p/${p.slug}`}>{p.title}</AppLink> <span className="row-meta"><RelativeTime iso={p.updated_at} /></span></li>)}</ul>
    </section>
  );
}

function Wanted({ info, base }: Props) {
  const t = useT();
  const q = useQuery({ queryKey: ['wiki', info.ref, 'wanted'], queryFn: () => api.get<{ wanted: { slug: string; title: string; count: number }[] }>(`${W(info.ref)}/wanted`) });
  return (
    <section aria-labelledby="wiki-wanted-h">
      <h2 id="wiki-wanted-h">{t('wiki.wanted')}</h2>
      <p className="hint">{t('wiki.wantedIntro')}</p>
      {q.isPending && <Loading rows={3} />}
      {q.data && q.data.wanted.length === 0 && <EmptyState>{t('wiki.noWanted')}</EmptyState>}
      <ul className="rows">
        {q.data?.wanted.map((w) => (
          <li key={w.slug}>
            <AppLink to={`${base}p/${w.slug}`} className="wiki-missing">{w.title}</AppLink> <span className="row-meta">{t('wiki.linkedFrom', { count: w.count })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Search({ info, base }: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const r = useQuery({ queryKey: ['wiki', info.ref, 'search', q], queryFn: () => api.get<{ hits: WikiSearchHit[] }>(`${W(info.ref)}/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2 });
  return (
    <section aria-labelledby="wiki-search-h">
      <h2 id="wiki-search-h">{t('wiki.search')}</h2>
      <form role="search" className="toolbar" onSubmit={(e) => { e.preventDefault(); setQ(text.trim()); }}>
        <TextField label={t('wiki.searchLabel')} value={text} onChange={setText} maxLength={200} />
        <button type="submit" className="btn" disabled={text.trim().length < 2}>{t('wiki.search')}</button>
      </form>
      {r.isFetching && <Loading rows={2} />}
      {r.data && r.data.hits.length === 0 && <EmptyState>{t('wiki.noHits')}</EmptyState>}
      <ul className="rows">
        {r.data?.hits.map((h) => (
          <li key={h.slug}>
            <AppLink to={`${base}p/${h.slug}`}><strong>{h.title}</strong></AppLink>
            <p className="row-meta">{h.snippet.split(/(\u0002[^\u0003]*\u0003)/).map((part, i) => part.startsWith('\u0002') ? <mark key={i}>{part.slice(1, -1)}</mark> : part)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
