import type { Me } from '@app/shared';
import { ApiError } from './api';

const KEY = 'me:last';

// The signed-in user as the server last said, kept for this tab only. When the network is down the shell
// stays up as that person (with its offline banner) instead of showing the visitor page; the server still
// decides everything, and a 401 or signing out forgets it.
const store = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };
const remember = (me: Me | null) => { try { if (me) store()?.setItem(KEY, JSON.stringify(me)); else store()?.removeItem(KEY); } catch { /* storage may be blocked */ } };
const recall = (): Me | null => { try { const raw = store()?.getItem(KEY); return raw ? (JSON.parse(raw) as Me) : null; } catch { return null; } };

export async function loadMe(get: () => Promise<Me | null>): Promise<Me | null> {
  try {
    const me = await get();
    remember(me);
    return me;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { remember(null); return null; }
    const last = recall();
    if (last) return last; // offline or the server is down: not the same as signed out
    throw err;
  }
}
