// Live updates (M9): a hint pushed to open browser tabs when something they show has changed. A hint
// carries no content: the tab refetches, and the usual access checks run on the refetch. Where a hint
// does name a place (a board's slug), it goes only to people who may read that place.
// One core process holds this, like presence does.
export type LiveEvent =
  | { type: 'notifications' }
  | { type: 'mail'; thread?: string }
  | { type: 'board'; slug: string; thread: string }
  | { type: 'announcements' }
  | { type: 'classics' }
  | { type: 'presence' }
  | { type: 'wiki'; wiki: string; slug: string; revision: number };

export interface LiveSub { userId: string; confirmed: boolean; send: (e: LiveEvent) => void; close: () => void }

const subs = new Set<LiveSub>();

export function subscribeLive(sub: LiveSub): () => void {
  subs.add(sub);
  return () => { subs.delete(sub); };
}

export const liveCount = (): number => subs.size;
export const liveStreamsOf = (userId: string): LiveSub[] => [...subs].filter((s) => s.userId === userId);

// To particular people.
export function liveTo(userIds: Iterable<string>, e: LiveEvent): void {
  const want = new Set(userIds);
  for (const s of subs) if (want.has(s.userId)) s.send(e);
}

// To everyone with a tab open; confirmedOnly leaves out people who have not confirmed their email yet.
export function liveAll(e: LiveEvent, opts: { confirmedOnly?: boolean } = {}): void {
  for (const s of subs) if (!opts.confirmedOnly || s.confirmed) s.send(e);
}
