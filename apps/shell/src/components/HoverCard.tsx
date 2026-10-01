import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PublicProfile } from '@app/shared';
import { api } from '../api';
import { useT } from '../hooks';
import { OpenAppLink } from '../shell/OpenAppLink';
import { Avatar } from './ui';

// A small card about a person, shown after a short hover or when their link has focus. It is a convenience:
// everything in it is also on their profile page, and Escape closes it.
export function HoverCard({ handle, meId, children }: { handle: string; meId?: string; children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 350); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
  // Escape closes it wherever focus is (a hover leaves focus where it was).
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const q = useQuery({
    queryKey: ['profile', handle.toLowerCase()], enabled: open, staleTime: 60_000,
    queryFn: () => api.get<PublicProfile>(`/users/${encodeURIComponent(handle)}`),
  });
  const p = q.data;
  return (
    <span className="hover-host" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {open && p && (
        <span className="hover-card" role="group" aria-label={t('hover.label', { name: p.display_name || p.handle })} onPointerEnter={show} onPointerLeave={hide}>
          <span className="hover-head">
            <Avatar id={p.id} name={p.display_name || p.handle} />
            <span><strong>{p.display_name || p.handle}</strong><br /><span className="muted">@{p.handle} · {t(`role.${p.role}`)}</span></span>
          </span>
          {p.bio && <span className="hover-bio">{p.bio.length > 140 ? `${p.bio.slice(0, 140)}…` : p.bio}</span>}
          {p.rings.length > 0 && <span className="muted">{t('hover.rings', { count: p.rings.length })}</span>}
          {meId && meId !== p.id && <OpenAppLink app="mail" to={`new/${p.handle}`} className="link">{t('hover.mail')}</OpenAppLink>}
        </span>
      )}
    </span>
  );
}
