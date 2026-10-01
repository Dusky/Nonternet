import { useConfirm } from '../../components/feedback';
import { useEffect, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OP_SCOPES, ROLES, type Role } from '@app/shared';
import { api } from '../../api';
import { Alert, BackLink, CopyButton, EmptyState, Loading, TextField } from '../../components/ui';
import { errorText, formatWhen, useT } from '../../hooks';
import { AppLink } from '../../nav';
import { AuditItem, type HistoryRow } from './AuditPanel';
import { useDebounced } from './useDebounced';

interface UserRow { id: string; handle: string; display_name: string | null; email: string; role: Role; status: string; created_at: string; last_seen_at: string | null }
interface OpRow { id: string; scope: string; scope_id: string }
interface Dossier {
  user: UserRow & { role_rev: number; bio: string | null; email_verified: boolean; totp_enabled: boolean };
  ops: OpRow[]; invite: { code: string; created_by: string | null } | null; active_sessions: number; history: HistoryRow[];
  vouching: { vouched_by: { voucher: string; note: string; at: string; state: string }[]; sponsor_flags: { candidate: string; reason: string; at: string }[] };
}
interface InviteRow { code: string; created_by: string | null; used_by: string | null; expires_at: string; status: 'open' | 'used' | 'expired' }

// ---------------------------------------------------------------- users

export function Users() {
  const t = useT();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const query = useInfiniteQuery({
    queryKey: ['admin', 'users', dq, role, status],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '25' });
      if (dq) p.set('q', dq);
      if (role) p.set('role', role);
      if (status) p.set('status', status);
      if (pageParam) p.set('before', pageParam);
      return api.get<{ users: UserRow[]; next_before: string | null }>(`/admin/users?${p}`);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
  const users = query.data?.pages.flatMap((p) => p.users) ?? [];

  return (
    <>
      <div className="filters">
        <TextField label={t('admin.users.search')} value={q} onChange={setQ} type="search" autoCapitalize="none" spellCheck={false} />
        <div className="field">
          <label htmlFor="f-role">{t('admin.users.roleFilter')}</label>
          <select id="f-role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t('admin.users.any')}</option>
            {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-status">{t('admin.users.statusFilter')}</label>
          <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.users.any')}</option>
            {(['active', 'suspended', 'deleted'] as const).map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
        </div>
      </div>
      {query.isError && <Alert kind="error">{errorText(query.error)}</Alert>}
      {query.isSuccess && users.length === 0 && <EmptyState>{t('admin.users.none')}</EmptyState>}
      {users.length > 0 && (
        <table className="table">
          <thead><tr><th scope="col">{t('admin.col.handle')}</th><th scope="col">{t('admin.col.role')}</th><th scope="col">{t('admin.col.status')}</th><th scope="col">{t('admin.col.joined')}</th><th scope="col">{t('admin.col.lastSeen')}</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <th scope="row" data-label={t('admin.col.handle')}><AppLink to={`users/${u.id}`}>{u.handle}</AppLink>{u.display_name && <span className="muted"> {u.display_name}</span>}</th>
                <td data-label={t('admin.col.role')}>{t(`role.${u.role}`)}</td>
                <td data-label={t('admin.col.status')}>{t(`status.${u.status as 'active'}`)}</td>
                <td data-label={t('admin.col.joined')}>{formatWhen(u.created_at)}</td>
                <td data-label={t('admin.col.lastSeen')}>{formatWhen(u.last_seen_at) ?? t('admin.never')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {query.hasNextPage && <button className="btn" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>{t('admin.users.more')}</button>}
    </>
  );
}

// ---------------------------------------------------------------- one user

export function UserPage({ myId, id }: { myId: string; id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api.get<Dossier>(`/admin/users/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });

  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  if (!q.data) return <Loading />;
  const { user, ops, invite, history, vouching } = q.data;
  const own = user.id === myId;

  return (
    <>
      <BackLink to="users">{t('admin.user.back')}</BackLink>
      <h2>{user.handle} <span className="badge">{t(`role.${user.role}`)}</span> {user.status !== 'active' && <span className="badge badge-warn">{t(`status.${user.status as 'active'}`)}</span>}</h2>
      {user.display_name && <p>{user.display_name}</p>}
      <ul className="facts">
        <li>{user.email}</li>
        <li>{user.email_verified ? t('admin.user.emailOk') : t('admin.user.emailNo')}</li>
        <li>{user.totp_enabled ? t('admin.user.totpOn') : t('admin.user.totpOff')}</li>
        <li>{t('admin.user.sessions', { count: q.data.active_sessions })}</li>
        <li>{t('admin.col.joined')}: {formatWhen(user.created_at)}</li>
        <li>{t('admin.col.lastSeen')}: {formatWhen(user.last_seen_at) ?? t('admin.never')}</li>
        <li>{invite ? t('admin.user.invitedBy', { name: invite.created_by ?? '?', code: invite.code }) : t('admin.user.noInvite')}</li>
      </ul>
      {own && <Alert kind="info">{t('admin.user.ownAccount')}</Alert>}
      {user.status === 'suspended' && <Alert kind="info">{t('admin.user.suspendedNote')}</Alert>}

      <RoleForm userId={id} current={user.role} disabled={own} onDone={refresh} />
      <RenameForm userId={id} current={user.handle} onDone={refresh} />
      <DeleteForm userId={id} handle={user.handle} disabled={own} onDone={refresh} />
      <SuspendForm userId={id} suspended={user.status === 'suspended'} disabled={own} onDone={refresh} />
      <OpsSection userId={id} ops={ops} onDone={refresh} />

      {(vouching.vouched_by.length > 0 || vouching.sponsor_flags.length > 0) && (
        <section aria-labelledby="vouching">
          <h3 id="vouching">{t('admin.user.vouching')}</h3>
          <ul>
            {vouching.vouched_by.map((v, i) => <li key={`v${i}`}>{t('admin.user.vouchedBy', { name: v.voucher, state: v.state })}{v.note && <> <q>{v.note}</q></>}</li>)}
            {vouching.sponsor_flags.map((f, i) => <li key={`f${i}`}><span className="badge badge-warn">{t('admin.user.sponsorFlag', { name: f.candidate, reason: f.reason })}</span></li>)}
          </ul>
        </section>
      )}
      <section aria-labelledby="history">
        <h3 id="history">{t('admin.user.history')}</h3>
        {history.length === 0 ? <p>{t('admin.user.noHistory')}</p> : <ol className="timeline">{history.map((h) => <AuditItem key={h.id} entry={h} />)}</ol>}
      </section>
    </>
  );
}

const reasonOk = (s: string) => s.trim().length >= 3;

function RoleForm({ userId, current, disabled, onDone }: { userId: string; current: Role; disabled: boolean; onDone: () => void }) {
  const t = useT();
  const [role, setRole] = useState<Role>(current);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setRole(current), [current]);
  const change = useMutation({
    mutationFn: () => api.post(`/admin/users/${userId}/role`, { role, reason }),
    onSuccess: () => { setReason(''); onDone(); },
    onError: (e) => setError(errorText(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); change.mutate(); };
  return (
    <form onSubmit={submit} className="panel">
      <h3>{t('admin.user.role')}</h3>
      <div className="field">
        <label htmlFor={`role-${userId}`}>{t('admin.col.role')}</label>
        <select id={`role-${userId}`} value={role} disabled={disabled} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </select>
      </div>
      <TextField label={t('field.reason')} value={reason} onChange={setReason} hint={t('admin.user.reasonHint')} disabled={disabled} />
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-primary" type="submit" disabled={disabled || change.isPending || role === current || !reasonOk(reason)}>{t('admin.user.apply')}</button>
    </form>
  );
}

function RenameForm({ userId, current, onDone }: { userId: string; current: string; onDone: () => void }) {
  const t = useT();
  const [handle, setHandle] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: () => api.post(`/admin/users/${userId}/rename`, { handle, reason }),
    onSuccess: () => { setHandle(''); setReason(''); onDone(); },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); act.mutate(); }} className="panel">
      <h3>{t('admin.user.rename')}</h3>
      <TextField label={t('admin.user.renameNew')} hint={t('admin.user.renameHint')} value={handle} onChange={setHandle} autoCapitalize="none" spellCheck={false} maxLength={20} />
      <TextField label={t('field.reason')} value={reason} onChange={setReason} hint={t('admin.user.reasonHint')} />
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn" type="submit" disabled={act.isPending || !handle.trim() || handle === current || !reasonOk(reason)}>{t('admin.user.apply')}</button>
    </form>
  );
}

function DeleteForm({ userId, handle, disabled, onDone }: { userId: string; handle: string; disabled: boolean; onDone: () => void }) {
  const t = useT();
  const confirm = useConfirm();
  const [reason, setReason] = useState('');
  const [posts, setPosts] = useState<'keep' | 'erase'>('keep');
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({ mutationFn: () => api.post(`/admin/users/${userId}/delete`, { reason, posts }), onSuccess: () => { setReason(''); onDone(); }, onError: (e) => setError(errorText(e)) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); void confirm({ message: t('data.delete.confirm'), confirmLabel: t('confirm.delete'), danger: true }).then((ok) => ok && act.mutate()); }} className="panel">
      <h3>{t('admin.user.delete')}</h3>
      <p className="hint">{t('admin.user.deleteHint')}</p>
      <fieldset>
        <legend>{t('data.delete.postsLegend')}</legend>
        <label className="check"><input type="radio" name={`dposts-${userId}`} checked={posts === 'keep'} onChange={() => setPosts('keep')} />{t('data.delete.postsKeep')}</label>
        <label className="check"><input type="radio" name={`dposts-${userId}`} checked={posts === 'erase'} onChange={() => setPosts('erase')} />{t('data.delete.postsErase')}</label>
      </fieldset>
      <TextField label={t('field.reason')} value={reason} onChange={setReason} hint={t('admin.user.reasonHint')} disabled={disabled} />
      {error && <Alert kind="error">{error}</Alert>}
      <button className="btn btn-danger" type="submit" disabled={disabled || act.isPending || !reasonOk(reason)} aria-label={`${t('admin.user.deleteGo')}: ${handle}`}>{t('admin.user.deleteGo')}</button>
    </form>
  );
}

function SuspendForm({ userId, suspended, disabled, onDone }: { userId: string; suspended: boolean; disabled: boolean; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: () => api.post(`/admin/users/${userId}/${suspended ? 'unsuspend' : 'suspend'}`, { reason }),
    onSuccess: () => { setReason(''); onDone(); },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); act.mutate(); }} className="panel">
      <h3>{suspended ? t('admin.user.unsuspend') : t('admin.user.suspend')}</h3>
      <TextField label={t('field.reason')} value={reason} onChange={setReason} hint={t('admin.user.reasonHint')} disabled={disabled} />
      {error && <Alert kind="error">{error}</Alert>}
      <button className={`btn ${suspended ? '' : 'btn-danger'}`} type="submit" disabled={disabled || act.isPending || !reasonOk(reason)}>{suspended ? t('admin.user.unsuspend') : t('admin.user.suspend')}</button>
    </form>
  );
}

function OpsSection({ userId, ops, onDone }: { userId: string; ops: OpRow[]; onDone: () => void }) {
  const t = useT();
  const [scope, setScope] = useState<(typeof OP_SCOPES)[number]>('board');
  const [scopeId, setScopeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const grant = useMutation({
    mutationFn: () => api.post(`/admin/users/${userId}/ops`, { scope, scope_id: scopeId.trim() }),
    onSuccess: () => { setScopeId(''); onDone(); },
    onError: (e) => setError(errorText(e)),
  });
  const revoke = useMutation({ mutationFn: (opId: string) => api.del(`/admin/users/${userId}/ops/${opId}`), onSuccess: onDone, onError: (e) => setError(errorText(e)) });
  return (
    <section className="panel" aria-labelledby="ops">
      <h3 id="ops">{t('admin.user.ops')}</h3>
      {ops.length === 0 ? <p>{t('admin.user.opsNone')}</p> : (
        <ul className="ops">
          {ops.map((o) => (
            <li key={o.id}><code>{o.scope}:{o.scope_id}</code> <button type="button" className="btn btn-quiet" onClick={() => revoke.mutate(o.id)} disabled={revoke.isPending}>{t('admin.user.revoke')}</button></li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); setError(null); grant.mutate(); }}>
        <div className="field">
          <label htmlFor={`scope-${userId}`}>{t('admin.user.opScope')}</label>
          <select id={`scope-${userId}`} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>{OP_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </div>
        <TextField label={t('admin.user.opId')} value={scopeId} onChange={setScopeId} autoCapitalize="none" spellCheck={false} />
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn" type="submit" disabled={grant.isPending || !scopeId.trim()}>{t('admin.user.grantOp')}</button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- invites

export function Invites() {
  const t = useT();
  const qc = useQueryClient();
  const [days, setDays] = useState('14');
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin', 'invites'], queryFn: () => api.get<{ invites: InviteRow[] }>('/admin/invites') });
  const create = useMutation({
    mutationFn: () => api.post<{ code: string; expires_at: string }>('/admin/invites', { expires_in_days: Number(days) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'invites'] }),
    onError: (e) => setError(errorText(e)),
  });
  const signupLink = (code: string) => `${window.location.origin}/signup?invite=${encodeURIComponent(code)}`;

  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); setError(null); create.mutate(); }} className="panel">
        <TextField label={t('admin.invites.days')} value={days} onChange={setDays} type="number" min={1} max={90} inputMode="numeric" required />
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn btn-primary" type="submit" disabled={create.isPending}>{t('admin.invites.create')}</button>
      </form>
      {create.data && (
        <Alert kind="success">
          <span data-testid="new-invite">{t('admin.invites.created', { code: create.data.code })}</span>{' '}
          <CopyButton text={signupLink(create.data.code)} />
        </Alert>
      )}
      {list.isError && <Alert kind="error">{errorText(list.error)}</Alert>}
      {list.data && list.data.invites.length === 0 && <EmptyState>{t('admin.invites.none')}</EmptyState>}
      {list.data && list.data.invites.length > 0 && (
        <ul className="rows">
          {list.data.invites.map((i) => (
            <li key={i.code}>
              <code>{i.code}</code> <span className={`badge badge-${i.status}`}>{t(`admin.invites.state.${i.status}`)}</span>
              {i.used_by && <span className="muted"> {t('admin.invites.usedBy', { name: i.used_by })}</span>}
              {i.status === 'open' && <span className="muted"> {t('admin.invites.expires', { when: formatWhen(i.expires_at) ?? '' })}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

