import { useEffect, useId, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useMe, useT } from '../hooks';
import { AppLink, AppNavLink } from '../nav';
import { Icon, type IconName } from './Icon';

export function Alert({ kind, children, retry }: { kind: 'error' | 'success' | 'info' | 'warning'; children: ReactNode; retry?: () => void }) {
  const t = useT();
  // Errors interrupt a screen reader; the rest wait their turn. A failed load can offer to try again.
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {retry && <button type="button" className="btn btn-small" onClick={retry}>{t('common.retry')}</button>}
    </div>
  );
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
  multiline?: boolean;
}

// A labelled input. The hint and the error are tied to the input so a screen reader reads them.
export function TextField({ label, value, onChange, hint, error, multiline, ...rest }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const common = { id, value, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline
        ? <textarea {...common} rows={4} maxLength={rest.maxLength} onChange={(e) => onChange(e.target.value)} />
        : <input {...common} {...rest} onChange={(e) => onChange(e.target.value)} />}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard blocked: the text is still on screen to copy by hand */ }
    },
  };
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const { copied, copy } = useCopy();
  return <button type="button" className="btn btn-quiet" onClick={() => void copy(text)}>{copied ? t('common.copied') : label ?? t('common.copy')}</button>;
}

export function Centered({ title, children }: { title: string; children: ReactNode }) {
  const t = useT();
  return (
    <main className="center" id="main">
      <a className="center-brand" href="/"><span className="brand-mark" aria-hidden="true" />{t('landing.title')}</a>
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

// Nothing to show yet: one plain sentence, and the next step if there is one.
export function EmptyState({ icon = 'inbox', children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <p>{children}</p>
      {action}
    </div>
  );
}

// Waiting on the server. "rows" draws grey placeholder rows where a list will be, so the page
// doesn't jump when it arrives; screen readers hear "Loading" either way.
export function Loading({ rows }: { rows?: number }) {
  const t = useT();
  if (rows) {
    return (
      <div className="skeleton" role="status">
        <span className="sr-only">{t('common.loading')}</span>
        {Array.from({ length: rows }, (_, i) => <span key={i} aria-hidden="true" />)}
      </div>
    );
  }
  return <p className="loading" role="status">{t('common.loading')}</p>;
}

// A screen inside an app that doesn't exist (an old link, a typo): say so and offer the app's start.
export function NotFound() {
  const t = useT();
  return <EmptyState icon="search" action={<AppLink className="btn" to="">{t('error.notFoundBack')}</AppLink>}>{t('error.notFound')}</EmptyState>;
}

// "← Lounge": back up one level inside an app.
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <AppLink to={to} className="back-link"><Icon name="back" />{children}</AppLink>;
}

// Section tabs inside an app; the current one is marked for screen readers too.
export function Tabs({ label, items }: { label: string; items: { to: string; label: string }[] }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((i) => <AppNavLink key={i.to} to={i.to}>{i.label}</AppNavLink>)}
    </nav>
  );
}

// A list of sections down the side (on narrow screens it becomes a row of chips), and the section
// beside it. For apps with many sections: Settings, the admin console.
export function SideNav({ label, groups, children }: { label: string; groups: { label?: string; items: { to: string; label: string }[] }[]; children: ReactNode }) {
  return (
    <div className="app-frame">
      <div className="split">
        <nav className="side-nav" aria-label={label}>
          {groups.map((g, i) => (
            <div key={g.label ?? i} className="side-nav-group">
              {g.label && <p className="side-nav-label" aria-hidden="true">{g.label}</p>}
              {g.items.map((it) => <AppNavLink key={it.to} to={it.to}>{it.label}</AppNavLink>)}
            </div>
          ))}
        </nav>
        <div className="split-main">{children}</div>
      </div>
    </div>
  );
}

// Initials on a colour picked from the person's stable id (not their handle, which can change).
// Signed-in people see a person's picture when they have set one; everyone else sees the initials. One small list
// says who has a picture, so no one asks for a picture that is not there.
export function useAvatars(): Record<string, number> {
  const me = useMe().data;
  return useQuery({
    queryKey: ['avatars'], enabled: Boolean(me && me.role !== 'guest'), staleTime: 60_000,
    queryFn: () => api.get<{ avatars: Record<string, number> }>('/avatars'),
  }).data?.avatars ?? NO_AVATARS;
}
const NO_AVATARS: Record<string, number> = {};

export function Avatar({ id, name, size }: { id: string | null | undefined; name: string; size?: 'sm' | 'lg' }) {
  const version = useAvatars()[id ?? ''];
  let h = 0;
  for (const c of id ?? name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.replace(/^@/, '').split(/[\s_.-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <span className={`avatar${size ? ` avatar-${size}` : ''}`} style={{ '--hue': h % 360 } as CSSProperties} aria-hidden="true">
      {version ? <img src={`/api/v1/avatars/${id}?v=${version}`} alt="" loading="lazy" decoding="async" /> : initials}
    </span>
  );
}

const RTF_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

export function relativeWhen(iso: string, now = Date.now()): string {
  const secs = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of RTF_UNITS) if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  return rtf.format(0, 'second');
}

// "5 minutes ago", with the exact date and time on hover and for screen readers that ask.
export function RelativeTime({ iso }: { iso: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const exact = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return <time dateTime={iso} title={exact}>{relativeWhen(iso)}</time>;
}

