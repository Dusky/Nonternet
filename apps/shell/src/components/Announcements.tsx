import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useT } from '../hooks';

export interface AnnouncementData { id: string; title: string; body: string; level: 'info' | 'warning' }
const KEY = 'ui:dismissed-announcements';

function dismissed(): string[] {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as string[]; } catch { return []; }
}

// One announcement as it looks in the shell. Text only: whatever an admin types is drawn as text.
export function AnnouncementBox({ a, onDismiss }: { a: AnnouncementData; onDismiss?: () => void }) {
  const t = useT();
  return (
    <div className={`announcement announcement-${a.level}`} role={a.level === 'warning' ? 'alert' : 'status'} data-testid="announcement">
      <div><strong>{a.title}</strong>{a.body && <p className="announcement-body">{a.body}</p>}</div>
      {onDismiss && <button type="button" className="btn btn-quiet" onClick={onDismiss} aria-label={t('announcement.dismiss', { title: a.title })}>×</button>}
    </div>
  );
}

// The live announcements, above the page. Someone who dismisses one does not see it again on this device.
export function AnnouncementBanner() {
  const t = useT();
  const [gone, setGone] = useState<string[]>(dismissed);
  const q = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<{ announcements: AnnouncementData[] }>('/announcements'), refetchInterval: 300_000, staleTime: 60_000 });
  const shown = (q.data?.announcements ?? []).filter((a) => !gone.includes(a.id));
  if (shown.length === 0) return null;
  const dismiss = (id: string) => {
    const next = [...gone, id].slice(-50);
    setGone(next);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* remembering is a convenience */ }
  };
  return (
    <section className="announcements" aria-label={t('announcement.region')}>
      {shown.map((a) => <AnnouncementBox key={a.id} a={a} onDismiss={() => dismiss(a.id)} />)}
    </section>
  );
}
