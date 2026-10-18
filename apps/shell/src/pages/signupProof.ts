import { useCallback, useEffect, useRef, useState } from 'react';
import type { Challenge } from 'altcha-lib';
import { api } from '../api';

// The proof-of-work check at sign-up (docs/15): the browser fetches a small puzzle from core and solves it while the person
// fills in the form, a second or two of work that makes signing up in bulk expensive. No third party is involved.
export type ProofState = 'off' | 'working' | 'ready' | 'failed';

async function solve(): Promise<string | null> {
  const { challenge } = await api.get<{ challenge: Challenge | null }>('/auth/signup-challenge');
  if (!challenge) return null;
  const [{ solveChallenge }, { deriveKey }] = await Promise.all([import('altcha-lib'), import('altcha-lib/algorithms/web/sha')]);
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error('unsolved');
  return btoa(JSON.stringify({ challenge, solution }));
}

export function useSignupProof(enabled: boolean) {
  const [state, setState] = useState<ProofState>(enabled ? 'working' : 'off');
  const pending = useRef<Promise<string | null> | null>(null);
  const start = useCallback(() => {
    if (!enabled) return;
    setState('working');
    const p = solve();
    pending.current = p;
    p.then((v) => { if (pending.current === p) setState(v ? 'ready' : 'off'); }, () => { if (pending.current === p) setState('failed'); });
  }, [enabled]);
  useEffect(() => { start(); }, [start]);
  // Waits for the answer if it isn't ready yet. Each answer works once, so a new puzzle is started after it is used.
  const take = useCallback(async (): Promise<string | null> => {
    if (!enabled) return null;
    if (!pending.current) start();
    const proof = await pending.current!;
    pending.current = null;
    return proof;
  }, [enabled, start]);
  return { state, take, retry: start };
}
