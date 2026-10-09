import { useToast } from '../../components/feedback';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CREATABLE_VISIBILITIES, type BoardSummary } from '@app/shared';
import { api } from '../../api';
import { Alert, TextField, BackLink } from '../../components/ui';
import { errorText, useMe, useT } from '../../hooks';
import { useAppNav } from '../../nav';

function VisibilityField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <div className="field">
      <label htmlFor={id}>{t('boards.form.visibility')}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {CREATABLE_VISIBILITIES.map((v) => <option key={v} value={v}>{t(`boards.vis.${v}`)}</option>)}
      </select>
    </div>
  );
}

export function NewBoard() {
  const t = useT();
  const nav = useAppNav();
  const qc = useQueryClient();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<BoardSummary>('/boards', { slug, name, description, visibility }),
    onSuccess: (b) => { void qc.invalidateQueries({ queryKey: ['boards'] }); nav.go(b.slug); },
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); create.mutate(); };
  return (
    <>
      <BackLink to="">{t('boards.backToBoards')}</BackLink>
      <form className="panel" onSubmit={submit}>
        <h2>{t('boards.form.title')}</h2>
        <TextField label={t('boards.form.slug')} hint={t('boards.form.slugHint')} value={slug} onChange={(v) => setSlug(v.toLowerCase())}
          autoCapitalize="none" spellCheck={false} maxLength={32} required />
        <TextField label={t('boards.form.name')} value={name} onChange={setName} maxLength={60} required />
        <TextField label={t('boards.form.description')} value={description} onChange={setDescription} maxLength={500} multiline />
        <VisibilityField id="new-vis" value={visibility} onChange={setVisibility} />
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending}>{t('boards.form.create')}</button>
      </form>
    </>
  );
}

export function BoardSettings({ board }: { board: BoardSummary }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const [rules, setRules] = useState(board.rules);
  const [visibility, setVisibility] = useState(board.visibility === 'ring' ? 'public' : board.visibility);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['boards'] }); void qc.invalidateQueries({ queryKey: ['board', board.slug] }); };
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<BoardSummary>(`/boards/${board.slug}`, body),
    onSuccess: () => { setError(null); toast(t('common.saved')); refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  if (!board.can_moderate) return <p>{t('boards.settings.forbidden')}</p>;
  return (
    <>
      <BackLink to={board.slug}>{t('boards.back', { name: board.name })}</BackLink>
      <h2>{t('boards.settings.title', { name: board.name })}</h2>
      <form className="panel" onSubmit={(e) => { e.preventDefault(); patch.mutate({ name, description, rules, visibility }); }}>
        <TextField label={t('boards.form.name')} value={name} onChange={setName} maxLength={60} required />
        <TextField label={t('boards.form.description')} value={description} onChange={setDescription} maxLength={500} multiline />
        <TextField label={t('boards.form.rules')} value={rules} onChange={setRules} maxLength={2000} multiline />
        <VisibilityField id="set-vis" value={visibility} onChange={(v) => setVisibility(v as typeof visibility)} />
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={patch.isPending}>{t('common.save')}</button>
      </form>
      <div className="panel">
        <label className="check">
          <input type="checkbox" checked={board.archived} disabled={patch.isPending} onChange={(e) => patch.mutate({ archived: e.target.checked })} />
          {t('boards.settings.archive')}
        </label>
        <p className="hint">{t('boards.settings.archiveHint')}</p>
      </div>
      <Ops board={board} />
      {board.visibility === 'private' && <Members slug={board.slug} />}
    </>
  );
}

function Members({ slug }: { slug: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['board', slug, 'members'], queryFn: () => api.get<{ members: { id: string; handle: string }[] }>(`/boards/${slug}/members`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['board', slug, 'members'] });
  const add = useMutation({
    mutationFn: () => api.post(`/boards/${slug}/members`, { handle }),
    onSuccess: () => { setHandle(''); setError(null); void refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/boards/${slug}/members/${id}`), onSuccess: () => void refresh(), onError: (e) => setError(errorText(e)) });
  return (
    <section className="panel" aria-labelledby="members-h">
      <h3 id="members-h">{t('boards.settings.members')}</h3>
      <ul className="rows">
        {list.data?.members.map((m) => (
          <li key={m.id}>{m.handle}{' '}
            <button type="button" className="link" onClick={() => remove.mutate(m.id)}>{t('boards.settings.remove', { name: m.handle })}</button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate(); }}>
        <TextField label={t('boards.settings.addMember')} value={handle} onChange={setHandle} autoCapitalize="none" spellCheck={false} required />
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn" type="submit" disabled={add.isPending}>{t('boards.settings.add')}</button>
      </form>
    </section>
  );
}

function Ops({ board }: { board: BoardSummary }) {
  const t = useT();
  const me = useMe().data;
  const qc = useQueryClient();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const boss = me?.role === 'admin' || me?.id === board.owner.id; // only they choose the ops
  const list = useQuery({ queryKey: ['board', board.slug, 'ops'], queryFn: () => api.get<{ ops: { id: string; user: { id: string; handle: string } }[] }>(`/boards/${board.slug}/ops`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['board', board.slug, 'ops'] });
  const add = useMutation({
    mutationFn: () => api.post(`/boards/${board.slug}/ops`, { handle }),
    onSuccess: () => { setHandle(''); setError(null); void refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/boards/${board.slug}/ops/${id}`), onSuccess: () => void refresh(), onError: (e) => setError(errorText(e)) });
  return (
    <section className="panel" aria-labelledby="ops-h">
      <h3 id="ops-h">{t('boards.settings.ops')}</h3>
      <p className="hint">{t('boards.settings.opsHint')}</p>
      {list.data && list.data.ops.length === 0 && <p>{t('boards.settings.noOps')}</p>}
      <ul className="rows">
        {list.data?.ops.map((o) => (
          <li key={o.id}>{o.user.handle}{' '}
            {(boss || o.user.id === me?.id) && <button type="button" className="link" onClick={() => remove.mutate(o.id)}>{t('boards.settings.removeOp', { name: o.user.handle })}</button>}
          </li>
        ))}
      </ul>
      {boss && (
        <form onSubmit={(e) => { e.preventDefault(); setError(null); add.mutate(); }}>
          <TextField label={t('boards.settings.addOp')} value={handle} onChange={setHandle} autoCapitalize="none" spellCheck={false} required />
          <button className="btn" type="submit" disabled={add.isPending}>{t('boards.settings.add')}</button>
        </form>
      )}
      {error && <Alert kind="error">{error}</Alert>}
    </section>
  );
}
