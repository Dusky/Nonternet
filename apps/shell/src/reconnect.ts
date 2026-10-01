// How long to wait before the Nth try at getting a dropped connection back: 1 s, 2 s, 4 s … up to 30 s,
// with a little jitter so a restart of the server doesn't bring every tab back in the same instant.
export const backoffMs = (attempt: number, rand: () => number = Math.random): number =>
  Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5)) + Math.floor(rand() * 500);

// Whether a WebSocket closed because the connection was lost (1006: no goodbye; 1001: the server is going
// away; 1012/1013: restarting, try later) rather than because someone said goodbye or quit (1000, 1005).
export const wasDropped = (code: number): boolean => code === 1006 || code === 1001 || code === 1012 || code === 1013;
