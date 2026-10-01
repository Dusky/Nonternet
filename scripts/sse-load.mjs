// Holds many server-sent-event streams open, as many browser tabs would (docs/10 "Live", docs/19), and counts what reaches them.
// Used by scripts/load-test.mjs (--streams N) and by the 100-stream test in apps/core/src/live-load.test.ts.
// One person may hold at most 5 streams (the oldest is let go), so N streams need at least N/5 people.
export async function holdStreams({ base, origin, sids, count, signal }) {
  const state = { opened: 0, ended: 0, hints: 0, failed: 0, firstByteMs: [] };
  const open = async (sid) => {
    const t0 = performance.now();
    try {
      const r = await fetch(`${base}/api/v1/events`, { headers: { cookie: `sid=${sid}`, origin, accept: 'text/event-stream' }, signal });
      if (!r.ok || !r.body) { state.failed++; return; }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let first = true;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (first) { first = false; state.opened++; state.firstByteMs.push(performance.now() - t0); }
        state.hints += (decoder.decode(value, { stream: true }).match(/^event: /gm) ?? []).length;
      }
      state.ended++;
    } catch (e) {
      if (!signal?.aborted) state.failed++;
    }
  };
  const running = Array.from({ length: count }, (_, i) => open(sids[i % sids.length]));
  return {
    state,
    // Resolves once every stream has answered (or failed), so a test can start posting.
    async ready(timeoutMs = 15_000) {
      const end = Date.now() + timeoutMs;
      while (state.opened + state.failed < count && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
      return state;
    },
    done: Promise.all(running),
  };
}

export const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] ?? 0; };
