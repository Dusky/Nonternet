import { useConfirm } from '../../components/feedback';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAIL_BODY_MAX, MAIL_MAX_PEOPLE, MAIL_SUBJECT_MAX, REPORT_CATEGORIES, type MailMessageView, type MailPerson, type MailThreadSummary, type MailThreadView } from '@app/shared';
import { api } from '../../api';
import { Alert, Avatar, BackLink, EmptyState, Loading, NotFound, RelativeTime, TextField } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { AppLink, matchRoute, useAppNav, useSubtitle } from '../../nav';
import { PersonLink } from '../people/PersonLink';

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

function Inbox() {
  const t = useT();
  const q = useQuery({ queryKey: ['mail', 'list'], queryFn: () => api.get<{ threads: MailThreadSummary[]; unread: number }>('/mail'), refetchInterval: 60_000 });
  return (
    <>
      <div className="toolbar"><AppLink to="new" className="btn btn-primary">{t('mail.new')}</AppLink></div>
      <p className="hint">{t('mail.private')}</p>
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.data && q.data.threads.length === 0 && <EmptyState icon="inbox">{t('mail.none', { max: MAIL_MAX_PEOPLE })}</EmptyState>}
      {!q.data && !q.isError && <Loading rows={3} />}
      <ul className="rows mail-rows">
        {q.data?.threads.map((th) => (
          <li key={th.id} className={`mail-row${th.unread ? ' is-unread' : ''}`}>
            <Avatar id={th.people[0]?.id} name={th.people[0] ? who(t, th.people[0]) : '?'} />
            <div>
              <div className="row-head">
                <span><AppLink to={th.id}><strong>{th.subject}</strong></AppLink>{' '}
                  {th.unread && <span className="badge badge-accent">{t('mail.unreadBadge')}</span>}{' '}
                  {th.left && <span className="badge">{t('mail.leftBadge')}</span>}</span>
                <span className="row-meta"><RelativeTime iso={th.last_message_at} /></span>
              </div>
              <p className="row-meta">{t('mail.with', { names: th.people.length ? th.people.map((p) => who(t, p)).join(', ') : t('mail.nobody') })}</p>
              {th.last && th.last.excerpt && <p className="mail-excerpt">{th.last.author ? `${th.last.author}: ` : ''}{th.last.excerpt}</p>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// "alice, @bob carol" → ["alice", "bob", "carol"]
export const parseHandles = (s: string): string[] => [...new Set(s.split(/[\s,;]+/).map((h) => h.replace(/^@/, '').trim()).filter(Boolean))];

function Compose({ to: initial }: { to: string }) {
  const t = useT();
  const nav = useAppNav();
  const qc = useQueryClient();
  const [to, setTo] = useState(initial);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => api.post<{ id: string }>('/mail', { to: parseHandles(to), subject, body }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['mail'] }); nav.go(r.id, { replace: true }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); send.mutate(); };
  return (
    <>
      <BackLink to="">{t('mail.inbox')}</BackLink>
      <h2>{t('mail.new')}</h2>
      <form onSubmit={submit} className="panel">
        <TextField label={t('mail.to')} value={to} onChange={setTo} hint={t('mail.toHint', { max: MAIL_MAX_PEOPLE })} autoCapitalize="none" spellCheck={false} required />
        <TextField label={t('mail.subject')} value={subject} onChange={setSubject} maxLength={MAIL_SUBJECT_MAX} required />
        <TextField label={t('mail.body')} value={body} onChange={setBody} maxLength={MAIL_BODY_MAX} multiline required />
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
  const refresh = () => qc.invalidateQueries({ queryKey: ['mail'] });
  const [body, setBody] = useState('');
  const [adding, setAdding] = useState('');
  const send = useMutation({ mutationFn: () => api.post(`/mail/${id}/messages`, { body }), onSuccess: () => { setBody(''); void refresh(); } });
  const add = useMutation({ mutationFn: () => api.post(`/mail/${id}/people`, { handle: adding.trim().replace(/^@/, '') }), onSuccess: () => { setAdding(''); void refresh(); } });
  const leave = useMutation({ mutationFn: () => api.post(`/mail/${id}/leave`), onSuccess: () => { void refresh(); nav.go(''); } });
  const del = useMutation({ mutationFn: (mid: string) => api.del(`/mail/${id}/messages/${mid}`), onSuccess: () => void refresh() });

  useSubtitle(q.data?.subject);
  if (q.isError) return <><BackLink to="">{t('mail.inbox')}</BackLink><Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert></>;
  const th = q.data;
  if (!th) return <Loading rows={4} />;
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
      {th.left && <Alert kind="info">{t('mail.youLeft')}</Alert>}
      <ol className="posts mail-messages">
        {th.messages.map((m) => <Message key={m.id} m={m} threadId={id} canAct={!th.left} onDelete={() => { void confirm({ message: t('mail.deleteConfirm'), confirmLabel: t('confirm.deleteMessage'), danger: true }).then((ok) => ok && del.mutate(m.id)); }} />)}
      </ol>
      {del.isError && <Alert kind="error">{errorText(del.error)}</Alert>}
      {!th.left && (
        <>
          <form className="panel" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
            <TextField label={t('mail.reply')} value={body} onChange={setBody} maxLength={MAIL_BODY_MAX} multiline required />
            {send.isError && <Alert kind="error">{errorText(send.error)}</Alert>}
            <button type="submit" className="btn btn-primary" disabled={send.isPending || !body.trim()}>{t('mail.replySend')}</button>
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
  if (m.kind !== 'message') return <li className="mail-event">{t(m.kind === 'joined' ? 'mail.joined' : 'mail.left', { name })} · <RelativeTime iso={m.at} /></li>;
  return (
    <li>
      <article className={`post${m.mine ? ' is-mine' : ''}`} aria-label={t('boards.by', { name })}>
        <header className="post-head">
          {m.author.handle ? <PersonLink app="people" to={m.author.handle} className="person"><Avatar id={m.author.id} name={name} size="sm" /><strong>{name}</strong></PersonLink> : <span className="person"><Avatar id={null} name={name} size="sm" /><strong>{name}</strong></span>}
          <span className="muted">· <RelativeTime iso={m.at} /></span>
        </header>
        {m.deleted ? <p className="muted">{t('mail.deleted')}</p> : <pre className="post-body">{m.body}</pre>}
        {!m.deleted && canAct && (
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
