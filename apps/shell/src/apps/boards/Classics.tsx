import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BULLETIN_BODY_MAX, BULLETIN_TITLE_MAX, ONELINER_MAX, POLL_OPTIONS_MAX, POLL_OPTION_MAX, POLL_QUESTION_MAX, type BulletinSummary, type BulletinView, type PollSummary, type PollView } from '@app/shared';
import { api } from '../../api';
import { useConfirm } from '../../components/feedback';
import { Alert, BackLink, EmptyState, Loading, RelativeTime, TextField } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { RichText } from '../../components/RichText';
import { AppLink, useAppNav, useSubtitle } from '../../nav';

// BBS classics on the web (M9-E): bulletins and the voting booth. The same rows as the terminal's.

// ---------------------------------------------------------------- bulletins

export function BulletinList() {
  const t = useT();
  const me = useMe().data;
  const q = useQuery({ queryKey: ['classics', 'bulletins'], queryFn: () => api.get<{ bulletins: BulletinSummary[]; unread: number }>('/bulletins') });
  const [writing, setWriting] = useState(false);
  useSubtitle(t('classics.bulletins'));
  return (
    <>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <h2>{t('classics.bulletins')}</h2>
      {me?.role === 'admin' && <p><button type="button" className="btn btn-primary" onClick={() => setWriting(!writing)} aria-expanded={writing}>{t('classics.bulletins.write')}</button></p>}
      {writing && <BulletinForm onDone={() => setWriting(false)} />}
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.isPending && <Loading rows={3} />}
      {q.data && q.data.bulletins.length === 0 && <EmptyState>{t('classics.bulletins.none')}</EmptyState>}
      <ul className="rows">
        {q.data?.bulletins.map((b) => (
          <li key={b.id}>
            <div className="row-head">
              <span><AppLink to={`bulletins/${b.number}`}><strong>{`#${b.number} ${b.title}`}</strong></AppLink> {b.unread && <span className="badge badge-accent">{t('classics.new')}</span>}</span>
              <span className="row-meta"><RelativeTime iso={b.at} /></span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function BulletinForm({ number, initial, onDone }: { number?: number; initial?: { title: string; body: string }; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const save = useMutation({
    mutationFn: () => (number ? api.patch(`/admin/bulletins/${number}`, { title, body }) : api.post('/admin/bulletins', { title, body })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['classics'] }); onDone(); },
  });
  return (
    <form className="panel" aria-label={t('classics.bulletins.write')} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <TextField label={t('classics.bulletins.title')} value={title} onChange={setTitle} maxLength={BULLETIN_TITLE_MAX} required />
      <TextField label={t('classics.bulletins.body')} value={body} onChange={setBody} maxLength={BULLETIN_BODY_MAX} multiline required />
      {save.isError && <Alert kind="error">{errorText(save.error)}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{t('classics.bulletins.post')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

export function BulletinPage({ number }: { number: number }) {
  const t = useT();
  const me = useMe().data;
  const nav = useAppNav();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['classics', 'bulletin', number], queryFn: () => api.get<BulletinView>(`/bulletins/${number}`) });
  const [editing, setEditing] = useState(false);
  const hide = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/bulletins/${number}/hide`, { reason }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['classics'] }); nav.go('bulletins'); },
  });
  useSubtitle(q.data ? `#${q.data.number} ${q.data.title}` : null);
  if (q.isError) return <><BackLink to="bulletins">{t('classics.bulletins')}</BackLink><Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert></>;
  const b = q.data;
  if (!b) return <Loading rows={3} />;
  return (
    <article>
      <BackLink to="bulletins">{t('classics.bulletins')}</BackLink>
      <h2>{`#${b.number} ${b.title}`}</h2>
      <p className="hint"><RelativeTime iso={b.at} />{b.updated_at && <> · {t('classics.bulletins.updated')} <RelativeTime iso={b.updated_at} /></>}</p>
      {editing ? <BulletinForm number={b.number} initial={{ title: b.title, body: b.body }} onDone={() => setEditing(false)} /> : <RichText body={b.body} className="post-body" />}
      {me?.role === 'admin' && !editing && (
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => setEditing(true)}>{t('edit.edit')}</button>
          <button type="button" className="btn btn-quiet" onClick={() => { void confirm({ message: t('classics.bulletins.hideConfirm'), confirmLabel: t('classics.hide'), danger: true }).then((ok) => ok && hide.mutate('Taken down by an admin')); }}>{t('classics.hide')}</button>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- the voting booth

export function PollList() {
  const t = useT();
  const me = useMe().data;
  const q = useQuery({ queryKey: ['classics', 'polls'], queryFn: () => api.get<{ polls: PollSummary[] }>('/polls') });
  const [asking, setAsking] = useState(false);
  useSubtitle(t('classics.polls'));
  return (
    <>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <h2>{t('classics.polls')}</h2>
      <p className="hint">{t('classics.polls.hint')}</p>
      {(me?.role === 'admin' || me?.role === 'trusted') && <p><button type="button" className="btn btn-primary" onClick={() => setAsking(!asking)} aria-expanded={asking}>{t('classics.polls.ask')}</button></p>}
      {asking && <NewPoll onDone={() => setAsking(false)} />}
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      {q.isPending && <Loading rows={3} />}
      {q.data && q.data.polls.length === 0 && <EmptyState>{t('classics.polls.none')}</EmptyState>}
      <ul className="rows">
        {q.data?.polls.map((p) => (
          <li key={p.id}>
            <div className="row-head">
              <span><AppLink to={`polls/${p.id}`}><strong>{p.question}</strong></AppLink></span>
              <span className="row-meta">{p.voted ? t('classics.polls.voted') : p.closed ? t('classics.polls.closed') : <span className="badge badge-accent">{t('classics.polls.open')}</span>}</span>
            </div>
            {p.by && <p className="row-meta">{t('classics.polls.by', { name: p.by })}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}

function NewPoll({ onDone }: { onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const nav = useAppNav();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [days, setDays] = useState('');
  const make = useMutation({
    mutationFn: () => api.post<{ id: string }>('/polls', { question, options: options.map((o) => o.trim()).filter(Boolean), ...(days ? { closes_in_days: Number(days) } : {}) }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ['classics'] }); onDone(); nav.go(`polls/${r.id}`); },
  });
  return (
    <form className="panel" aria-label={t('classics.polls.ask')} onSubmit={(e) => { e.preventDefault(); make.mutate(); }}>
      <TextField label={t('classics.polls.question')} value={question} onChange={setQuestion} maxLength={POLL_QUESTION_MAX} required />
      {options.map((o, i) => (
        <TextField key={i} label={t('classics.polls.choice', { n: i + 1 })} value={o} onChange={(v) => setOptions(options.map((x, n) => (n === i ? v : x)))} maxLength={POLL_OPTION_MAX} required={i < 2} />
      ))}
      {options.length < POLL_OPTIONS_MAX && <p><button type="button" className="link" onClick={() => setOptions([...options, ''])}>{t('classics.polls.addChoice')}</button></p>}
      <div className="field">
        <label htmlFor="poll-days">{t('classics.polls.closes')}</label>
        <select id="poll-days" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="">{t('classics.polls.never')}</option>
          {[1, 7, 30].map((d) => <option key={d} value={d}>{t('classics.polls.days', { count: d })}</option>)}
        </select>
      </div>
      {make.isError && <Alert kind="error">{errorText(make.error)}</Alert>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={make.isPending}>{t('classics.polls.create')}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

export function PollPage({ id }: { id: string }) {
  const t = useT();
  const me = useMe().data;
  const nav = useAppNav();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['classics', 'poll', id], queryFn: () => api.get<PollView>(`/polls/${id}`) });
  const [choice, setChoice] = useState('');
  const vote = useMutation({
    mutationFn: () => api.post<PollView>(`/polls/${id}/vote`, { option_id: choice }),
    onSuccess: (p) => { qc.setQueryData(['classics', 'poll', id], p); void qc.invalidateQueries({ queryKey: ['classics', 'polls'] }); },
  });
  const hide = useMutation({
    mutationFn: () => api.post(`/admin/polls/${id}/hide`, { reason: 'Taken down by an admin' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['classics'] }); nav.go('polls'); },
  });
  useSubtitle(q.data?.question ?? null);
  if (q.isError) return <><BackLink to="polls">{t('classics.polls')}</BackLink><Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert></>;
  const p = q.data;
  if (!p) return <Loading rows={3} />;
  const canVote = !p.voted && !p.closed;
  return (
    <article>
      <BackLink to="polls">{t('classics.polls')}</BackLink>
      <h2>{p.question}</h2>
      <p className="hint">{p.by ? `${t('classics.polls.by', { name: p.by })} · ` : ''}{p.closed ? t('classics.polls.closed') : p.closes_at ? <>{t('classics.polls.until')} <RelativeTime iso={p.closes_at} /></> : t('classics.polls.open')}</p>
      {canVote ? (
        <form onSubmit={(e) => { e.preventDefault(); if (choice) vote.mutate(); }}>
          <fieldset>
            <legend>{t('classics.polls.yourChoice')}</legend>
            {p.options.map((o) => <label key={o.id} className="check"><input type="radio" name="choice" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} /> {o.label}</label>)}
          </fieldset>
          {vote.isError && <Alert kind="error">{errorText(vote.error)}</Alert>}
          <button type="submit" className="btn btn-primary" disabled={!choice || vote.isPending}>{t('classics.polls.vote')}</button>
          <p className="hint">{t('classics.polls.hideTally')}</p>
        </form>
      ) : (
        <>
          <ul className="plain poll-results" aria-label={t('classics.polls.results')}>
            {p.options.map((o) => (
              <li key={o.id}>
                <span>{o.label}{p.my_vote === o.id && <>{' '}<span className="badge">{t('classics.polls.yours')}</span></>}</span>
                <meter min={0} max={Math.max(1, p.total ?? 1)} value={o.votes ?? 0} aria-label={o.label} />
                <span>{t('classics.polls.votes', { count: o.votes ?? 0 })}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{t('classics.polls.total', { count: p.total ?? 0 })}</p>
        </>
      )}
      {me?.role === 'admin' && (
        <p><button type="button" className="btn btn-quiet" onClick={() => { void confirm({ message: t('classics.polls.hideConfirm'), confirmLabel: t('classics.hide'), danger: true }).then((ok) => ok && hide.mutate()); }}>{t('classics.hide')}</button></p>
      )}
    </article>
  );
}
