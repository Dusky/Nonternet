import type { AppDeps } from '../deps';
import { pullCharacters } from '../characters';

// Core tells the MUD what changed (docs/09): renames, roles, builder appointments, and who may no longer
// play (suspended or deleted people are disconnected at once). Core sends everyone's current state; the
// MUD applies it to the accounts it has. Events make this happen within a moment; it also runs every
// five minutes, so a missed event is repaired.

async function call<T>(deps: AppDeps, method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const mud = deps.mud!;
  const res = await fetch(`${mud.url}/internal/${path}`, {
    method,
    headers: { authorization: `Bearer ${mud.secrets.controlToken}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`mud ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface MudStatus {
  name: string;
  sessions: { account: string | null; core_id: string | null; character: string | null; room: string | null; idle_s: number; protocol: string }[];
  rooms: { room: string; people: number }[];
  counts: { accounts: number; characters: number; rooms: number; objects: number };
}
export const mudStatus = (deps: AppDeps) => call<MudStatus>(deps, 'GET', 'status');

export interface MudExport { account: string | null; created?: string; characters: Record<string, unknown>[] }
export const mudExport = (deps: AppDeps, coreId: string) => call<MudExport>(deps, 'POST', 'export', { core_id: coreId });

export async function pushAccounts(deps: AppDeps): Promise<{ renamed: number; roles: number; disconnected: number }> {
  const r = await deps.db.query<{ id: string; handle: string; status: string; role: string; builder: boolean }>(
    `SELECT u.id, u.handle, u.status, u.role,
            EXISTS (SELECT 1 FROM scoped_roles s WHERE s.user_id = u.id AND s.role = 'mud_builder' AND s.scope_type = 'mud') AS builder
     FROM users u`);
  // Guests can't play (Q4), so for the MUD they count as not active.
  const accounts = r.rows.map((u) => ({ core_id: u.id, handle: u.handle, status: u.status === 'active' && u.role !== 'guest' ? 'active' : u.status === 'active' ? 'unconfirmed' : u.status, role: u.role, builder: u.builder }));
  return call(deps, 'POST', 'accounts/sync', { accounts });
}

export async function sendMudAnnouncements(deps: AppDeps): Promise<number> {
  const r = await deps.db.query<{ id: string; title: string; body: string }>(
    `SELECT id, title, body FROM announcements WHERE 'mud' = ANY(channels) AND mud_sent_at IS NULL AND archived_at IS NULL
       AND starts_at <= to_timestamp($1 / 1000.0) AND (ends_at IS NULL OR ends_at > to_timestamp($1 / 1000.0)) ORDER BY starts_at`, [deps.now()]);
  for (const a of r.rows) {
    await call(deps, 'POST', 'broadcast', { text: a.body ? `${a.title}: ${a.body}` : a.title });
    await deps.db.query(`UPDATE announcements SET mud_sent_at = now() WHERE id = $1`, [a.id]);
  }
  return r.rows.length;
}

let hook: () => void = () => undefined;
export const mudSyncSoon = () => hook();

export function startMudSync(deps: AppDeps, log: (m: string) => void, opts: { everyMs?: number; announceMs?: number; charactersMs?: number } = {}) {
  let running = false;
  let again = false;
  const pass = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      await pushAccounts(deps);
      await pullCharacters(deps);
      await sendMudAnnouncements(deps);
    } catch (e) {
      log(`mud sync: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
      if (again) { again = false; void pass(); }
    }
  };
  let debounce: NodeJS.Timeout | undefined;
  const soon = () => { clearTimeout(debounce); debounce = setTimeout(() => void pass(), 200); };
  hook = soon;
  const every = setInterval(() => void pass(), opts.everyMs ?? 300_000);
  const announce = setInterval(() => void sendMudAnnouncements(deps).catch(() => undefined), opts.announceMs ?? 30_000);
  // Levels and coins change in play; the site's copy follows within two minutes.
  const characters = setInterval(() => void pullCharacters(deps).catch((e) => log(`mud characters: ${e instanceof Error ? e.message : String(e)}`)), opts.charactersMs ?? 120_000);
  void pass();
  return { soon, runNow: pass, stop: () => { hook = () => undefined; clearInterval(every); clearInterval(announce); clearInterval(characters); clearTimeout(debounce); } };
}
