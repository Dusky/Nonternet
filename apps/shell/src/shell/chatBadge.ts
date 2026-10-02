import { useSyncExternalStore } from 'react';

// How many chat mentions and direct messages are waiting, for the tab title. A tiny store of its own, so the shell
// can read it without loading the chat app (and its IRC library) until someone opens Chat.
let count = 0;
const listeners = new Set<() => void>();
export function setChatWaiting(n: number): void {
  if (n === count) return;
  count = n;
  for (const l of listeners) l();
}
export function useChatWaiting(): number {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => count, () => 0);
}
