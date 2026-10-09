import { toast, undoable, useConfirm } from '../../components/feedback';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { MAIL_BODY_MAX, MAIL_MAX_PEOPLE, MAIL_SUBJECT_MAX, MAIL_VIEWS, REPORT_CATEGORIES, type MailInbox, type MailView, type MailMessageView, type MailPerson, type MailThreadView } from '@app/shared';
import { api } from '../../api';
import { Alert, Avatar, BackLink, EmptyState, Loading, NotFound, RelativeTime, TextField } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { AppLink, matchRoute, useAppNav, useSubtitle } from '../../nav';
import { PersonLink } from '../people/PersonLink';
import { Editor } from '../../components/Editor';
import { clearDraft } from '../../drafts';
import { quoteReply } from '../../quote';
import { useDebounced } from '../admin/useDebounced';
import { useLiveQuery } from '@tanstack/react-db';
import { RichText } from '../../components/RichText';
import { FormatHelp } from '../../components/FormatHelp';
import { conversationCollection, isPending, pendingId } from '../../collections';

const ROUTES = ['', 'new', 'new/:to', ':id'] as const;

// Private mail (docs/10): conversations between two people or a small group, on this site only.
export default function MailApp() {
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  if (!route) return <div className="app-content"><NotFound /></div>;
  return (
    <div className="app-content">
      {route.pattern === '' && <Inbox />}
      {(route.pattern === 'new' || route.pattern === 'new/:to') && <Compose to={route.params.to ?? ''} />}
      {route.pattern === ':id' && <Conversation id={route.params.id!} />}
    </div>
  );
}

const who = (t: ReturnType<typeof useT>, p: MailPerson) => p.display_name || p.handle || t('mail.deletedPerson');

// No prefetch on conversation links: opening one marks it read on the server, so loading it early would too.
function Inbox() {
  const t = useT();
  const [find, setFind] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [view, setView] = useState<MailView>('inbox');
  const qc = useQueryClient();
  const [gone, setGone] = useState<string[]>([]); // archived or unarchived a moment ago: out of the list at once
  const term = useDebounced(find.trim(), 250);
  const q = useInfiniteQuery({
    queryKey: ['mail', 'list', term, unreadOnly, view],
    placeholderData: keepPreviousData, // the last results stay while new ones load, so typing doesn't flash "Loading"
    queryFn: ({ pageParam }) => api.get<MailInbox>(`/mail?${new URLSearchParams({ ...(term ? { q: term } : {}), ...(unreadOnly ? { unread: '1' } : {}), ...(view !== 'inbox' ? { view } : {}), ...(pageParam ? { before: pageParam } : {}) })}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    refetchInterval: 60_000,
  });
  const shown = (q.data?.pages.flatMap((p) => p.threads) ?? []).filter((th) => !gone.includes(th.id));
  const filtering = term !== '' || unreadOnly;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['mail'] }); };
  const star = useMutation({ mutationFn: (v: { id: string; on: boolean }) => (v.on ? api.put(`/mail/${v.id}/star`, {}) : api.del(`/mail/${v.id}/star`)), onSettled: refresh });
  // Archiving happens at once, and the note offers to take it back.
  const archive = (id: string, on: boolean) => {
    setGone((g) => [...g, id]);
    const send = (v: boolean) => (v ? api.put(`/mail/${id}/archive`, {}) : api.del(`/mail/${id}/archive`));
    const back = () => setGone((g) => g.filter((x) => x !== id));
    send(on).then(() => qc.invalidateQueries({ queryKey: ['mail'] })).then(back, (e) => { back(); toast(errorText(e), 'error'); });
    toast(t(on ? 'mail.archived' : 'mail.unarchived'), 'ok', { undo: () => { void send(!on).then(() => qc.invalidateQueries({ queryKey: ['mail'] })).then(back); } });
  };
  return (
    <>
      <div className="toolbar">
        <AppLink to="new" className="btn btn-primary">{t('mail.new')}</AppLink>
        <input type="search" aria-label={t('mail.search')} placeholder={t('mail.search')} value={find} onChange={(e) => setFind(e.target.value)} maxLength={80} />
        <button type="button" className={`btn btn-quiet${unreadOnly ? ' is-active' : ''}`} aria-pressed={unreadOnly} onClick={() => setUnreadOnly((u) => !u)}>{t('mail.unreadOnly')}</button>
      </div>
      <div className="toolbar" role="group" aria-label={t('mail.views')}>
        {MAIL_VIEWS.map((v) => <button key={v} type="button" className={`btn btn-quiet${view === v ? ' is-active' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{t(`mail.view.${v}`)}</button>)}
      </div>
      <p className="hint">{t('mail.private')}</p>
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.data && shown.length === 0 && <EmptyState icon="inbox" art="mail">{filtering ? t('mail.noMatch') : t('mail.none', { max: MAIL_MAX_PEOPLE })}</EmptyState>}
      {!q.data && !q.isError && <Loading rows={3} />}
      <ul className="rows mail-rows">
        {shown.map((th) => (
          <li key={th.id} className={`mail-row${th.unread ? ' is-unread' : ''}`}>
            <Avatar id={th.people[0]?.id} name={th.people[0] ? who(t, th.people[0]) : '?'} />
            <div>
              <div className="row-head">
                <span><AppLink to={th.id}><strong>{th.subject}</strong></AppLink>{' '}
                  {th.unread && <span className="badge badge-accent">{t('mail.unreadBadge')}</span>}{' '}
                  {th.left && <span className="badge">{t('mail.leftBadge')}</span>}{' '}
                  {th.muted && <span className="badge">{t('mail.mutedBadge')}</span>}</span>
                <span className="row-meta"><RelativeTime iso={th.last_message_at} /></span>
              </div>
              <p className="row-meta">{t('mail.with', { names: th.people.length ? th.people.map((p) => who(t, p)).join(', ') : t('mail.nobody') })}</p>
              {th.last && th.last.excerpt && <p className="mail-excerpt">{th.last.author ? `${th.last.author}: ` : ''}{th.last.excerpt}</p>}
              <p className="row-actions">
                <button type="button" className="link" aria-pressed={th.starred} onClick={() => star.mutate({ id: th.id, on: !th.starred })}>{th.starred ? t('mail.unstar') : t('mail.star')}</button>
                <button type="button" className="link" onClick={() => archive(th.id, !th.archived)}>{th.archived ? t('mail.unarchive') : t('mail.archive')}</button>
              </p>
            </div>
          </li>
        ))}
      </ul>
      {q.hasNextPage && <p><button type="button" className="btn btn-quiet" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t('mail.older')}</button></p>}
    </>
  );
}

// "alice, @bob carol" → ["alice", "bob", "carol"]
export const parseHandles = (s: string): string[] => [...new Set(s.split(/[\s,;]+/).map((h) => h.replace(/^@/, '').trim()).filter(Boolean))];

function Compose({ to: initial }: { to: string }) {
  const t = useT();
  const nav = useAppNav();
  const qc = useQueryClient();
  const me = useMe().data;
  const [to, setTo] = useState(initial);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => api.post<{ id: string }>('/mail', { to: parseHandles(to), subject, body }),
    onSuccess: (r) => { if (me) clearDraft(me.id, 'mail:new'); void qc.invalidateQueries({ queryKey: ['mail'] }); nav.go(r.id, { replace: true }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); send.mutate(); };
  return (
    <>
      <BackLink to="">{t('mail.inbox')}</BackLink>
      <h2>{t('mail.new')}</h2>
      <form onSubmit={submit} className="panel">
        <ToField value={to} onChange={setTo} />
        <TextField label={t('mail.subject')} value={subject} onChange={setSubject} maxLength={MAIL_SUBJECT_MAX} required />
        <Editor label={t('mail.body')} value={body} onChange={setBody} maxLength={MAIL_BODY_MAX} draftKey="mail:new" mentions required
          onSubmit={() => { if (to.trim() && subject.trim() && body.trim() && !send.isPending) send.mutate(); }}><FormatHelp /></Editor>
        {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
        <button type="submit" className="btn btn-primary" disabled={send.isPending}>{t('mail.send')}</button>
      </form>
    </>
  );
}

function Conversation({ id }: { id: string }) {
  const t = useT();
  const confirm = useConfirm();
  const nav = useAppNav();
  const qc = useQueryClient();
  const key = ['mail', 'thread', id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<MailThreadView>(`/mail/${id}`), refetchInterval: 30_000 });
  // Opening a conversation marks it read, so the counts elsewhere change.
  useEffect(() => { if (q.data) { void qc.invalidateQueries({ queryKey: ['mail', 'list'] }); void qc.invalidateQueries({ queryKey: ['mail', 'unread'] }); } }, [q.data, qc]);
  const me = useMe().data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['mail'] });
  const [body, setBody] = useState('');
  const [adding, setAdding] = useState('');
  // Messages live in a TanStack DB collection: a reply shows at once (marked as sending) and the server's copy replaces
  // it; if the server refuses, it disappears again and the text goes back in the box.
  const coll = conversationCollection(id);
  const live = useLiveQuery((qb) => qb.from({ m: coll }).orderBy(({ m }) => m.at, 'asc'), [id]);
  const messages = (live.data ?? []) as MailMessageView[];
  const [sendError, setSendError] = useState<string | null>(null);
  const sendNow = () => {
    const text = body;
    if (!text.trim() || !me) return;
    setBody('');
    setSendError(null);
    clearDraft(me.id, `mail:${id}`);
    const tx = coll.insert({ id: pendingId(), kind: 'message', author: { id: me.id, handle: me.handle, display_name: me.display_name ?? null }, body: text, deleted: false, at: new Date().toISOString(), mine: true });
    tx.isPersisted.promise.catch((e: unknown) => { setBody((b) => b || text); setSendError(errorText(e)); });
  };
  // Deleting shows at once and is sent when the Undo note's time is up (it can't be taken back after that).
  const [deleting, setDeleting] = useState<string[]>([]);
  const deleteSoon = (mid: string) => {
    setSendError(null);
    setDeleting((d) => [...d, mid]);
    const back = () => setDeleting((d) => d.filter((x) => x !== mid));
    undoable(t('mail.messageDeleted'), () => coll.update(mid, (d) => { d.deleted = true; d.body = ''; }).isPersisted.promise.finally(back), {
      onUndo: back, onError: (e) => setSendError(errorText(e)),
    });
  };
  const add = useMutation({ mutationFn: () => api.post(`/mail/${id}/people`, { handle: adding.trim().replace(/^@/, '') }), onSuccess: () => { setAdding(''); void refresh(); } });
  const leave = useMutation({ mutationFn: () => api.post(`/mail/${id}/leave`), onSuccess: () => { void refresh(); nav.go(''); } });
  const star = useMutation({ mutationFn: (on: boolean) => (on ? api.put(`/mail/${id}/star`, {}) : api.del(`/mail/${id}/star`)), onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); void refresh(); } });
  const archive = () => {
    void api.put(`/mail/${id}/archive`, {}).then(() => {
      void refresh(); nav.go('');
      toast(t('mail.archived'), 'ok', { undo: () => { void api.del(`/mail/${id}/archive`).then(() => void refresh()); } });
    }, (e) => toast(errorText(e), 'error'));
  };
  const unread = useMutation({ mutationFn: () => api.post(`/mail/${id}/unread`), onSuccess: () => { void refresh(); nav.go(''); } });
  const [newName, setNewName] = useState('');
  const rename = useMutation({ mutationFn: () => api.patch(`/mail/${id}`, { subject: newName.trim() }), onSuccess: () => { setNewName(''); void qc.invalidateQueries({ queryKey: key }); void refresh(); } });
  const mute = useMutation({ mutationFn: (on: boolean) => (on ? api.put(`/mail/${id}/mute`, {}) : api.del(`/mail/${id}/mute`)), onSuccess: () => void refresh() });

  const inboxMuted = q.data?.muted ?? false;
  const end = useRef<HTMLOListElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!q.data || scrolled.current) return;
    scrolled.current = true;
    end.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [q.data]);
  // A reply of your own scrolls into view as soon as it is on screen.
  const count = messages.length;
  useEffect(() => { if (scrolled.current) end.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }); }, [count]);
  useSubtitle(q.data?.subject);
  if (q.isError) return <><BackLink to="">{t('mail.inbox')}</BackLink><Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert></>;
  const th = q.data;
  if (!th) return <Loading rows={4} />;
  const lastTheirs = [...messages].reverse().find((m) => m.kind === 'message' && !m.mine && !m.deleted);
  return (
    <div>
      <BackLink to="">{t('mail.inbox')}</BackLink>
      <h2>{th.subject}</h2>
      <section aria-labelledby="mail-people">
        <h3 id="mail-people" className="visually-hidden">{t('mail.people')}</h3>
        <p className="hint">{t('mail.withLabel')} {th.people.length === 0 && t('mail.nobody')}{th.people.map((p, i) => (
          <span key={p.id ?? i}>{i > 0 && ', '}{p.handle ? <PersonLink app="people" to={p.handle}>{who(t, p)}</PersonLink> : who(t, p)}</span>
        ))}</p>
      </section>
      {!th.left && (
        <div className="toolbar">
          <button type="button" className="btn btn-quiet" aria-pressed={th.starred} onClick={() => star.mutate(!th.starred)}>{th.starred ? t('mail.unstar') : t('mail.star')}</button>
          <button type="button" className="btn btn-quiet" onClick={archive}>{t('mail.archive')}</button>
          <button type="button" className="btn btn-quiet" onClick={() => unread.mutate()} disabled={unread.isPending}>{t('mail.markUnread')}</button>
        </div>
      )}
      {th.left && <Alert kind="info">{t('mail.youLeft')}</Alert>}
      <ol className="posts mail-messages" ref={end}>
        {messages.map((m) => <Message key={m.id} m={deleting.includes(m.id) ? { ...m, deleted: true } : m} threadId={id} canAct={!th.left} onDelete={() => deleteSoon(m.id)} />)}
      </ol>
      {!th.left && (
        <>
          <form className="panel" onSubmit={(e) => { e.preventDefault(); sendNow(); }}>
            <Editor label={t('mail.reply')} value={body} onChange={setBody} maxLength={MAIL_BODY_MAX} draftKey={`mail:${id}`} mentions required
              onSubmit={sendNow}>
              {lastTheirs && lastTheirs.body && <button type="button" className="link" onClick={() => setBody((b) => quoteReply(who(t, lastTheirs.author), lastTheirs.body!) + b)}>{t('mail.quote')}</button>}
              <FormatHelp />
            </Editor>
            {sendError && <Alert kind="error">{sendError}</Alert>}
            <button type="submit" className="btn btn-primary" disabled={!body.trim()}>{t('mail.replySend')}</button>
          </form>
          <details className="panel">
          <summary>{t('mail.manage')}</summary>
          {th.people.length + 1 < MAIL_MAX_PEOPLE && (
            <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
              <TextField label={t('mail.add')} value={adding} onChange={setAdding} hint={t('mail.addHint')} maxLength={40} autoCapitalize="none" spellCheck={false} required />
              {add.isError && <Alert kind="error">{errorText(add.error)}</Alert>}
              <button type="submit" className="btn" disabled={add.isPending}>{t('mail.addButton')}</button>
            </form>
          )}
          {th.people.length >= 3 && (
            <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) rename.mutate(); }}>
              <TextField label={t('mail.rename')} value={newName} onChange={setNewName} maxLength={MAIL_SUBJECT_MAX} required />
              {rename.isError && <Alert kind="error">{errorText(rename.error)}</Alert>}
              <button type="submit" className="btn" disabled={rename.isPending || !newName.trim()}>{t('mail.renameButton')}</button>
            </form>
          )}
          <p><button type="button" className="btn" aria-pressed={inboxMuted} disabled={mute.isPending} onClick={() => mute.mutate(!inboxMuted)}>{inboxMuted ? t('mail.unmute') : t('mail.mute')}</button> <span className="hint">{t('mail.muteHint')}</span></p>
          <p><button type="button" className="btn btn-danger" onClick={() => { void confirm({ message: t('mail.leaveConfirm'), confirmLabel: t('confirm.leave'), danger: true }).then((ok) => ok && leave.mutate()); }} disabled={leave.isPending}>{t('mail.leave')}</button></p>
          {leave.isError && <Alert kind="error">{errorText(leave.error)}</Alert>}
          </details>
        </>
      )}
    </div>
  );
}

function Message({ m, threadId, canAct, onDelete }: { m: MailMessageView; threadId: string; canAct: boolean; onDelete: () => void }) {
  const t = useT();
  const name = who(t, m.author);
  if (m.kind !== 'message') return <li className="mail-event">{m.kind === 'renamed' ? t('mail.renamed', { name, subject: m.body }) : t(m.kind === 'joined' ? 'mail.joined' : 'mail.left', { name })} · <RelativeTime iso={m.at} /></li>;
  return (
    <li>
      <article className={`post${m.mine ? ' is-mine' : ''}`} aria-label={t('boards.by', { name })}>
        <header className="post-head">
          {m.author.handle ? <PersonLink app="people" to={m.author.handle} className="person"><Avatar id={m.author.id} name={name} size="sm" /><strong>{name}</strong></PersonLink> : <span className="person"><Avatar id={null} name={name} size="sm" /><strong>{name}</strong></span>}
          <span className="muted">· {isPending(m.id) ? t('mail.sending') : <RelativeTime iso={m.at} />}</span>
        </header>
        {m.deleted ? <p className="muted">{t('mail.deleted')}</p> : <RichText body={m.body} className="post-body" />}
        {!m.deleted && canAct && !isPending(m.id) && (
          <footer className="post-actions">
            {m.mine ? <button type="button" className="link" onClick={onDelete}>{t('mail.delete')}</button> : m.author.id && <ReportMessage threadId={threadId} messageId={m.id} />}
          </footer>
        )}
      </article>
    </li>
  );
}

function ReportMessage({ threadId, messageId }: { threadId: string; messageId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>('abuse');
  const [note, setNote] = useState('');
  const send = useMutation({ mutationFn: () => api.post(`/mail/${threadId}/messages/${messageId}/report`, { category, note }) });
  if (send.isSuccess) return <span className="muted" role="status">{t('mail.report.sent')}</span>;
  return (
    <>
      <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{t('mail.report')}</button>
      {open && (
        <form className="panel" aria-label={t('mail.report.title')} onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <p className="hint">{t('mail.report.intro')}</p>
          <div className="field">
            <label htmlFor={`cat-${messageId}`}>{t('boards.report.category')}</label>
            <select id={`cat-${messageId}`} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
              {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`boards.report.cat.${c}`)}</option>)}
            </select>
          </div>
          <TextField label={t('boards.report.note')} value={note} onChange={setNote} maxLength={500} multiline />
          {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={send.isPending}>{t('boards.report.send')}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
          </div>
        </form>
      )}
    </>
  );
}

// "alice, bo" suggests handles that start with "bo" (a datalist, so it works with a keyboard and a screen reader).
function ToField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const last = value.split(/[\s,;]+/).pop()?.replace(/^@/, '') ?? '';
  const prefix = useDebounced(last, 150);
  const people = useQuery({
    queryKey: ['mentions', prefix], enabled: prefix.length > 0, staleTime: 60_000,
    queryFn: () => api.get<{ people: { id: string; handle: string; display_name: string | null }[] }>(`/mentions?prefix=${encodeURIComponent(prefix)}`),
  }).data?.people ?? [];
  const head = value.slice(0, value.length - last.length);
  const listId = 'mail-to-people';
  return (
    <>
      <TextField label={t('mail.to')} value={value} onChange={onChange} hint={t('mail.toHint', { max: MAIL_MAX_PEOPLE })} autoCapitalize="none" spellCheck={false} list={listId} autoComplete="off" required />
      <datalist id={listId}>{last && people.map((p) => <option key={p.id} value={`${head}${p.handle}`} label={p.display_name ?? undefined} />)}</datalist>
    </>
  );
}
