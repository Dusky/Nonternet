import { useEffect, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OP_SCOPES, ROLES, type Role } from '@app/shared';
import { api } from '../../api';
import { Alert, CopyButton, TextField } from '../../components/ui';
import { errorText, formatWhen, useMe, useT } from '../../hooks';
import { AppLink, AppNavLink, matchRoute, useAppNav } from '../../nav';

interface UserRow { id: string; handle: string; display_name: string | null; email: string; role: Role; status: string; created_at: string; last_seen_at: string | null }
interface OpRow { id: string; scope: string; scope_id: string }
interface HistoryRow { id: number; at: string; actor_handle: string | null; actor_kind: string; action: string; target_type: string | null; target_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
interface Dossier {
  user: UserRow & { role_rev: number; bio: string | null; email_verified: boolean; totp_enabled: boolean };
  ops: OpRow[]; invite: { code: string; created_by: string | null } | null; active_sessions: number; history: HistoryRow[];
}
interface InviteRow { code: string; created_by: string | null; used_by: string | null; expires_at: string; status: 'open' | 'used' | 'expired' }

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

const ROUTES = ['users', 'users/:id', 'invites', 'audit'] as const;

export default function AdminApp() {
  const t = useT();
  const me = useMe().data;
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  useEffect(() => { if (!route) nav.go('users', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  if (me?.role !== 'admin') return <p className="pad">{t('admin.forbidden')}</p>;
  return (
    <div className="app">
      <nav className="tabs" aria-label={t('app.admin')}>
        <AppNavLink to="users">{t('admin.tab.users')}</AppNavLink>
        <AppNavLink to="invites">{t('admin.tab.invites')}</AppNavLink>
        <AppNavLink to="audit">{t('admin.tab.audit')}</AppNavLink>
      </nav>
      <div className="app-content">
        {route?.pattern === 'users' && <Users />}
        {route?.pattern === 'users/:id' && <UserPage myId={me.id} id={route.params.id!} />}
        {route?.pattern === 'invites' && <Invites />}
        {route?.pattern === 'audit' && <Audit />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- users

function Users() {
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
      {query.isSuccess && users.length === 0 && <p>{t('admin.users.none')}</p>}
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

function UserPage({ myId, id }: { myId: string; id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api.get<Dossier>(`/admin/users/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });

  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  if (!q.data) return <p className="pad">{t('common.loading')}</p>;
  const { user, ops, invite, history } = q.data;
  const own = user.id === myId;

  return (
    <>
      <p><AppLink to="users">&#8592; {t('admin.user.back')}</AppLink></p>
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
      <SuspendForm userId={id} suspended={user.status === 'suspended'} disabled={own} onDone={refresh} />
      <OpsSection userId={id} ops={ops} onDone={refresh} />

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

function Invites() {
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
      {list.data && list.data.invites.length === 0 && <p>{t('admin.invites.none')}</p>}
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

// ---------------------------------------------------------------- audit log

function AuditItem({ entry }: { entry: HistoryRow }) {
  const t = useT();
  const who = entry.actor_handle ?? (entry.actor_kind === 'cli' ? t('admin.audit.cli') : t('admin.audit.system'));
  const reason = typeof entry.after?.reason === 'string' ? entry.after.reason : null;
  const change = entry.before?.role && entry.after?.role ? `${String(entry.before.role)} → ${String(entry.after.role)}` : null;
  return (
    <li>
      <time dateTime={entry.at}>{formatWhen(entry.at)}</time>{' '}
      <strong>{entry.action}</strong> <span className="muted">{t('admin.audit.by', { actor: who })}</span>
      {entry.target_type === 'user' && entry.target_id && <> <AppLink to={`users/${entry.target_id}`}>{entry.target_id.slice(0, 10)}</AppLink></>}
      {change && <> <code>{change}</code></>}
      {reason && <> <q>{reason}</q></>}
    </li>
  );
}

function Audit() {
  const t = useT();
  const [action, setAction] = useState('');
  const da = useDebounced(action);
  const query = useInfiniteQuery({
    queryKey: ['admin', 'audit', da],
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '50' });
      if (da) p.set('action', da);
      if (pageParam) p.set('before', String(pageParam));
      return api.get<{ entries: HistoryRow[]; next_before: number | null }>(`/admin/audit?${p}`);
    },
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
  const entries = query.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <>
      <TextField label={t('admin.audit.filter')} value={action} onChange={setAction} hint={t('admin.audit.filterHint')} autoCapitalize="none" spellCheck={false} />
      {query.isError && <Alert kind="error">{errorText(query.error)}</Alert>}
      {query.isSuccess && entries.length === 0 && <p>{t('admin.audit.none')}</p>}
      {entries.length > 0 && <ol className="timeline">{entries.map((e) => <AuditItem key={e.id} entry={e} />)}</ol>}
      {query.hasNextPage && <button className="btn" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>{t('admin.audit.more')}</button>}
    </>
  );
}
