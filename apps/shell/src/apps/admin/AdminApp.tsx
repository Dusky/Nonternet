import { useEffect, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OP_SCOPES, ROLES, type Role } from '@app/shared';
import { api } from '../../api';
import { Alert, CopyButton, TextField } from '../../components/ui';
import { errorText, formatWhen, useMe, useSite, useT } from '../../hooks';
import { AppLink, AppNavLink, matchRoute, useAppNav } from '../../nav';
import { VouchesPanel } from './VouchesPanel';
import { AuditReplay, CommandConsole, StatsPanel } from './ConsoleDepth';
import type { BoardSummary } from '@app/shared';
import { ReportQueue } from '../boards/ReportQueue';
import { ReasonForm } from '../boards/ModTools';
import { AnnouncementsPanel, LegalPanel, SettingsPanel } from './ConfigPanels';
import { BackupsPanel, StatusPanel } from './StatusPanels';
import { IrcPanel } from './IrcPanel';
import { MudPanel } from './MudPanel';
import { OpenAppLink } from '../../shell/OpenAppLink';

interface UserRow { id: string; handle: string; display_name: string | null; email: string; role: Role; status: string; created_at: string; last_seen_at: string | null }
interface OpRow { id: string; scope: string; scope_id: string }
interface HistoryRow { id: number; at: string; actor_handle: string | null; actor_kind: string; action: string; target_type: string | null; target_id: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }
interface Dossier {
  user: UserRow & { role_rev: number; bio: string | null; email_verified: boolean; totp_enabled: boolean };
  ops: OpRow[]; invite: { code: string; created_by: string | null } | null; active_sessions: number; history: HistoryRow[];
  vouching: { vouched_by: { voucher: string; note: string; at: string; state: string }[]; sponsor_flags: { candidate: string; reason: string; at: string }[] };
}
interface InviteRow { code: string; created_by: string | null; used_by: string | null; expires_at: string; status: 'open' | 'used' | 'expired' }

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

const ROUTES = ['status', 'users', 'users/:id', 'invites', 'audit', 'reports', 'boards', 'rings', 'homepages', 'settings', 'announcements', 'legal', 'irc', 'mud', 'backups', 'vouches', 'stats', 'console', 'audit/replay/:type/:id'] as const;

export default function AdminApp() {
  const t = useT();
  const me = useMe().data;
  const site = useSite();
  const nav = useAppNav();
  const route = matchRoute(nav.path, ROUTES);
  useEffect(() => { if (!route) nav.go('status', { replace: true }); }, [route]); // eslint-disable-line react-hooks/exhaustive-deps
  if (me?.role !== 'admin') return <p className="pad">{t('admin.forbidden')}</p>;
  return (
    <div className="app">
      <nav className="tabs" aria-label={t('app.admin')}>
        <AppNavLink to="status">{t('admin.tab.status')}</AppNavLink>
        <AppNavLink to="users">{t('admin.tab.users')}</AppNavLink>
        <AppNavLink to="invites">{t('admin.tab.invites')}</AppNavLink>
        <AppNavLink to="vouches">{t('admin.tab.vouches')}</AppNavLink>
        <AppNavLink to="reports">{t('admin.tab.moderation')}</AppNavLink>
        <AppNavLink to="boards">{t('admin.tab.boards')}</AppNavLink>
        <AppNavLink to="rings">{t('admin.tab.rings')}</AppNavLink>
        <AppNavLink to="homepages">{t('admin.tab.homepages')}</AppNavLink>
        <AppNavLink to="announcements">{t('admin.tab.announcements')}</AppNavLink>
        <AppNavLink to="settings">{t('admin.tab.config')}</AppNavLink>
        {site.services.irc && <AppNavLink to="irc">{t('admin.tab.irc')}</AppNavLink>}
        {site.services.mud && <AppNavLink to="mud">{t('admin.tab.mud')}</AppNavLink>}
        <AppNavLink to="legal">{t('admin.tab.legal')}</AppNavLink>
        <AppNavLink to="backups">{t('admin.tab.backups')}</AppNavLink>
        <AppNavLink to="audit">{t('admin.tab.audit')}</AppNavLink>
        <AppNavLink to="stats">{t('admin.tab.stats')}</AppNavLink>
        <AppNavLink to="console">{t('admin.tab.console')}</AppNavLink>
      </nav>
      <div className="app-content">
        {route?.pattern === 'status' && <StatusPanel />}
        {route?.pattern === 'legal' && <LegalPanel />}
        {route?.pattern === 'irc' && <IrcPanel />}
        {route?.pattern === 'mud' && <MudPanel />}
        {route?.pattern === 'backups' && <BackupsPanel />}
        {route?.pattern === 'users' && <Users />}
        {route?.pattern === 'users/:id' && <UserPage myId={me.id} id={route.params.id!} />}
        {route?.pattern === 'invites' && <Invites />}
        {route?.pattern === 'vouches' && <VouchesPanel />}
        {route?.pattern === 'reports' && <ReportQueue />}
        {route?.pattern === 'boards' && <BoardsTable />}
        {route?.pattern === 'rings' && <RingsTable />}
        {route?.pattern === 'homepages' && <HomepagesTable />}
        {route?.pattern === 'settings' && <SettingsPanel />}
        {route?.pattern === 'announcements' && <AnnouncementsPanel />}
        {route?.pattern === 'audit' && <Audit />}
        {route?.pattern === 'audit/replay/:type/:id' && <AuditReplay type={route.params.type!} id={route.params.id!} />}
        {route?.pattern === 'stats' && <StatsPanel />}
        {route?.pattern === 'console' && <CommandConsole />}
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
  const { user, ops, invite, history, vouching } = q.data;
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
  const [reason, setReason] = useState('');
  const [posts, setPosts] = useState<'keep' | 'erase'>('keep');
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({ mutationFn: () => api.post(`/admin/users/${userId}/delete`, { reason, posts }), onSuccess: () => { setReason(''); onDone(); }, onError: (e) => setError(errorText(e)) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(null); if (window.confirm(t('data.delete.confirm'))) act.mutate(); }} className="panel">
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
      {entry.target_type && entry.target_id && <> <AppLink to={`audit/replay/${encodeURIComponent(entry.target_type)}/${encodeURIComponent(entry.target_id)}`} aria-label={t('admin.replay.linkLabel', { id: entry.target_id })}>{t('admin.replay.link')}</AppLink></>}
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

// ---------------------------------------------------------------- boards

function BoardsTable() {
  const t = useT();
  const q = useQuery({ queryKey: ['boards', 'admin'], queryFn: () => api.get<{ boards: BoardSummary[] }>('/boards') });
  if (q.isError) return <Alert kind="error">{errorText(q.error)}</Alert>;
  if (!q.data) return <p className="pad">{t('common.loading')}</p>;
  const boards = q.data.boards;
  return (
    <>
      <p className="hint">{t('admin.boards.hint')}</p>
      {boards.length === 0 && <p>{t('admin.boards.none')}</p>}
      {boards.length > 0 && (
        <table className="table">
          <thead><tr>
            <th scope="col">{t('admin.boards.col.name')}</th><th scope="col">{t('admin.boards.col.owner')}</th><th scope="col">{t('admin.boards.col.visibility')}</th>
            <th scope="col">{t('admin.boards.col.threads')}</th><th scope="col">{t('admin.boards.col.last')}</th>
          </tr></thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.id}>
                <th scope="row" data-label={t('admin.boards.col.name')}>
                  <OpenAppLink app="boards" to={b.slug}>{b.name}</OpenAppLink>{b.archived && <> <span className="badge">{t('boards.badge.archived')}</span></>}
                </th>
                <td data-label={t('admin.boards.col.owner')}>{b.owner.handle}</td>
                <td data-label={t('admin.boards.col.visibility')}>{t(`boards.vis.short.${b.visibility === 'ring' ? 'public' : b.visibility}`)}</td>
                <td data-label={t('admin.boards.col.threads')}>{b.thread_count}</td>
                <td data-label={t('admin.boards.col.last')}>{formatWhen(b.last_post_at) ?? t('admin.never')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ---------------------------------------------------------------- homepages

interface HpRow { user_id: string; handle: string; title: string; size_bytes: number; file_count: number; has_index: boolean; last_updated_at: string | null; hidden: boolean; url: string }
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function HomepagesTable() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [acting, setActing] = useState<HpRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'homepages', dq],
    queryFn: () => api.get<{ homepages: HpRow[]; totals: { homepages: string; bytes: string; hidden: string } }>(`/admin/homepages${dq ? `?q=${encodeURIComponent(dq)}` : ''}`),
  });
  const run = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/homepages/${acting!.user_id}/${acting!.hidden ? 'restore' : 'hide'}`, { reason }),
    onSuccess: () => { setActing(null); setError(null); void qc.invalidateQueries({ queryKey: ['admin'] }); }, onError: (e) => setError(errorText(e)),
  });
  if (list.isError) return <Alert kind="error">{errorText(list.error)}</Alert>;
  const d = list.data;
  return (
    <>
      <TextField label={t('admin.homepages.search')} value={q} onChange={setQ} type="search" autoCapitalize="none" spellCheck={false} />
      {d && <p className="hint">{t('admin.homepages.totals', { count: d.totals.homepages, size: mb(Number(d.totals.bytes)), hidden: d.totals.hidden })}</p>}
      {d && d.homepages.length === 0 && <p>{t('admin.homepages.none')}</p>}
      {d && d.homepages.length > 0 && (
        <table className="table">
          <thead><tr>
            <th scope="col">{t('admin.homepages.col.owner')}</th><th scope="col">{t('admin.homepages.col.title')}</th><th scope="col">{t('admin.homepages.col.size')}</th>
            <th scope="col">{t('admin.homepages.col.updated')}</th><th scope="col">{t('admin.homepages.col.state')}</th>
          </tr></thead>
          <tbody>
            {d.homepages.map((h) => (
              <tr key={h.user_id}>
                <th scope="row" data-label={t('admin.homepages.col.owner')}><a href={h.url} target="_blank" rel="noopener noreferrer">{h.handle}</a></th>
                <td data-label={t('admin.homepages.col.title')}>{h.title}</td>
                <td data-label={t('admin.homepages.col.size')}>{mb(h.size_bytes)}</td>
                <td data-label={t('admin.homepages.col.updated')}>{formatWhen(h.last_updated_at) ?? t('admin.never')}</td>
                <td data-label={t('admin.homepages.col.state')}>
                  {h.hidden && <span className="badge badge-warn">{t('admin.homepages.hidden')}</span>}{' '}
                  <button type="button" className="link" onClick={() => { setError(null); setActing(h); }} aria-label={t('admin.homepages.hideThis', { name: h.handle })}>
                    {h.hidden ? t('admin.homepages.restore') : t('admin.homepages.hide')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {acting && (
        <ReasonForm label={t('admin.homepages.hideThis', { name: acting.handle })} submitLabel={t('boards.mod.confirm')} pending={run.isPending} error={error}
          onSubmit={(reason) => run.mutate(reason)} onCancel={() => setActing(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- rings

interface RingRow { id: string; slug: string; name: string; founder: string; members: number; archived: boolean; hidden: boolean; board: string | null }

function RingsTable() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [acting, setActing] = useState<RingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['admin', 'rings', dq], queryFn: () => api.get<{ rings: RingRow[] }>(`/admin/rings${dq ? `?q=${encodeURIComponent(dq)}` : ''}`) });
  const run = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/rings/${acting!.id}/${acting!.hidden ? 'restore' : 'hide'}`, { reason }),
    onSuccess: () => { setActing(null); setError(null); void qc.invalidateQueries({ queryKey: ['admin'] }); }, onError: (e) => setError(errorText(e)),
  });
  if (list.isError) return <Alert kind="error">{errorText(list.error)}</Alert>;
  const rings = list.data?.rings ?? [];
  return (
    <>
      <TextField label={t('admin.rings.search')} value={q} onChange={setQ} type="search" autoCapitalize="none" spellCheck={false} />
      {list.data && rings.length === 0 && <p>{t('admin.rings.none')}</p>}
      {rings.length > 0 && (
        <table className="table">
          <thead><tr>
            <th scope="col">{t('admin.rings.col.name')}</th><th scope="col">{t('admin.rings.col.founder')}</th><th scope="col">{t('admin.rings.col.members')}</th><th scope="col">{t('admin.rings.col.state')}</th>
          </tr></thead>
          <tbody>
            {rings.map((r) => (
              <tr key={r.id}>
                <th scope="row" data-label={t('admin.rings.col.name')}><OpenAppLink app="rings" to={r.slug}>{r.name}</OpenAppLink></th>
                <td data-label={t('admin.rings.col.founder')}>{r.founder}</td>
                <td data-label={t('admin.rings.col.members')}>{r.members}</td>
                <td data-label={t('admin.rings.col.state')}>
                  {r.archived && <span className="badge">{t('boards.badge.archived')}</span>} {r.hidden && <span className="badge badge-warn">{t('admin.homepages.hidden')}</span>}{' '}
                  <button type="button" className="link" onClick={() => { setError(null); setActing(r); }} aria-label={t(r.hidden ? 'admin.rings.restoreThis' : 'admin.rings.hideThis', { name: r.name })}>
                    {t(r.hidden ? 'admin.rings.restore' : 'admin.rings.hide')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {acting && <ReasonForm label={t(acting.hidden ? 'admin.rings.restoreThis' : 'admin.rings.hideThis', { name: acting.name })} submitLabel={t('boards.mod.confirm')} pending={run.isPending} error={error} onSubmit={(reason) => run.mutate(reason)} onCancel={() => setActing(null)} />}
    </>
  );
}
