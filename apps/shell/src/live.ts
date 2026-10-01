import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

// Live updates (M9, docs/10). One server-sent event stream per tab: core says "something changed" and the tab
// refetches what it shows. A hint carries no content, so the usual access checks run on the refetch.
// If the stream cannot be had (a proxy that buffers, a restart, the network), 'polling' says so and the
// counters go back to checking every minute; the stream is retried with growing pauses.
export type LiveStatus = 'connecting' | 'live' | 'polling';
export const useLive = create<{ status: LiveStatus; set: (s: LiveStatus) => void }>((set) => ({ status: 'connecting', set: (status) => set({ status }) }));

export const POLL_FAST = 60_000;   // counters when there is no stream
export const POLL_SLOW = 300_000;  // a safety net while there is one

// How often a counter should check by itself.
export const pollMs = (status: LiveStatus): number => (status === 'live' ? POLL_SLOW : POLL_FAST);

interface Hint { type: 'notifications' | 'mail' | 'board' | 'announcements' | 'presence'; slug?: string; thread?: string }

export function applyHint(qc: QueryClient, h: Hint): void {
  const inv = (queryKey: unknown[]) => void qc.invalidateQueries({ queryKey });
  switch (h.type) {
    case 'notifications': inv(['notifications']); break;
    case 'mail': inv(['mail']); break;
    case 'announcements': inv(['announcements']); break;
    case 'presence': inv(['online']); break;
    case 'board':
      inv(['boards']);
      if (h.slug) { inv(['board', h.slug]); inv(['threads', h.slug]); }
      if (h.slug && h.thread) inv(['thread', h.slug, h.thread]);
      break;
  }
}

const TYPES: Hint['type'][] = ['notifications', 'mail', 'board', 'announcements', 'presence'];

export function useLiveEvents(userId: string | null): void {
  const qc = useQueryClient();
  const set = useLive((s) => s.set);
  useEffect(() => {
    if (!userId || typeof EventSource === 'undefined') { set('polling'); return; }
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    const open = () => {
      if (stopped) return;
      set('connecting');
      source = new EventSource('/api/v1/events');
      source.onopen = () => { failures = 0; set('live'); void qc.invalidateQueries(); }; // catch up on anything missed
      for (const type of TYPES) {
        source.addEventListener(type, (e) => {
          try { applyHint(qc, JSON.parse((e as MessageEvent<string>).data) as Hint); } catch { /* a malformed hint is ignored */ }
        });
      }
      source.onerror = () => {
        // The browser retries by itself while the stream is merely interrupted; a closed one (the server
        // ended it, or the session is gone) is reopened by us after a growing pause.
        set('polling');
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          failures++;
          timer = setTimeout(open, Math.min(60_000, 2_000 * 2 ** Math.min(failures, 5)));
        }
      };
    };
    open();

    const onVisible = () => { if (document.visibilityState === 'visible') void qc.invalidateQueries(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, qc, set]);
}
