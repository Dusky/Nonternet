import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { toast } from '../../components/feedback';
import { Alert, Loading, RelativeTime } from '../../components/ui';
import { errorText, useT } from '../../hooks';
import { deviceParts } from './device';
import { Section } from './Section';

interface SessionView { id: string; kind: 'web' | 'bbs'; user_agent: string; created_at: string; last_used_at: string | null; current: boolean }

// Where you are signed in (docs/02): each browser or terminal session, and a way to end any of them but this one,
// or all of them at once. Ending one is recorded in the audit log.
export function Sessions() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ sessions: SessionView[] }>('/me/sessions') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['sessions'] });
  const one = useMutation({ mutationFn: (id: string) => api.del(`/me/sessions/${id}`), onSuccess: () => { toast(t('sessions.signedOutOne')); refresh(); }, onError: (e) => toast(errorText(e), 'error') });
  const others = useMutation({
    mutationFn: () => api.post<{ revoked: number }>('/me/sessions/revoke-others'),
    onSuccess: (r) => { toast(t('sessions.signedOutOthers', { count: r.revoked })); refresh(); },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const name = (s: SessionView) => {
    if (s.kind === 'bbs') return t('sessions.bbs');
    const { browser, os } = deviceParts(s.user_agent);
    return browser && os ? t('sessions.browserOn', { browser, os }) : browser ?? os ?? t('sessions.aBrowser');
  };
  const list = q.data?.sessions ?? [];
  return (
    <Section id="sessions-h" title={t('settings.tab.sessions')} intro={t('sessions.intro')}>
      {q.isPending && <Loading rows={2} />}
      {q.isError && <Alert kind="error" retry={() => void q.refetch()}>{errorText(q.error)}</Alert>}
      <ul className="rows">
        {list.map((s) => (
          <li key={s.id} className="session-row">
            <div>
              <strong>{name(s)}</strong> {s.current && <span className="badge badge-accent">{t('sessions.thisOne')}</span>}
              <p className="row-meta">
                {s.last_used_at ? <>{t('sessions.lastUsed')} <RelativeTime iso={s.last_used_at} /> · </> : null}
                {t('sessions.since')} <RelativeTime iso={s.created_at} />
              </p>
            </div>
            {!s.current && (
              <button type="button" className="btn btn-small" disabled={one.isPending} aria-label={`${t('sessions.signOut')}: ${name(s)}`} onClick={() => one.mutate(s.id)}>
                {t('sessions.signOut')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {list.length > 1
        ? <button type="button" className="btn" disabled={others.isPending} onClick={() => others.mutate()}>{t('sessions.signOutOthers')}</button>
        : q.isSuccess && <p className="hint">{t('sessions.onlyHere')}</p>}
    </Section>
  );
}
