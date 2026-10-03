import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { audit } from './audit';
import type { Ctx, SessionUser } from './accounts';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { newId } from './crypto';
import { verifyPassword } from './passwords';

// Updating and restarting from the console (docs/19). Core never touches Docker: it writes a small request file into the
// shared ops folder (OPS_DIR), and `sitectl agent`, running on the host, checks it against the same short list, runs it,
// and writes back the job's state and log. So the most a stolen admin session can do is ask for one of these actions.

export const OPS_ACTIONS = ['restart', 'upgrade', 'check'] as const;
export const OPS_SERVICES = ['all', 'core', 'homes', 'shell', 'caddy', 'bbs', 'gopher', 'mud', 'ergo'] as const;
export type OpsAction = typeof OPS_ACTIONS[number];
const ID = /^op_[0-9A-Z]{26}$/;
const AGENT_ALIVE_MS = 60_000; // the agent writes a heartbeat every few seconds
const LOG_TAIL_BYTES = 64 * 1024;

export interface OpsJob { id: string; action: OpsAction; service: string | null; state: 'queued' | 'running' | 'done' | 'failed'; by: string | null; requested_at: string | null; started_at: string | null; finished_at: string | null }
export interface OpsVersion { commit: string; subject: string; date: string; branch: string; behind: number; pending: { commit: string; subject: string }[]; checked_at: string }
export interface OpsStatus { configured: boolean; agent: { seen_at: string | null; alive: boolean }; version: OpsVersion | null; jobs: OpsJob[] }

// key=value lines, so the agent can read them with plain shell tools and nothing to parse.
export const parseKv = (text: string): Record<string, string> =>
  Object.fromEntries(text.split('\n').map((l) => l.match(/^([a-z_]+)=(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1]!, m[2]!]));

async function readKv(path: string): Promise<Record<string, string> | null> {
  try { return parseKv(await fs.readFile(path, 'utf8')); } catch { return null; }
}

const iso = (s: string | undefined) => (s && /^\d+$/.test(s) ? new Date(Number(s) * 1000).toISOString() : null);

export async function opsStatus(deps: AppDeps): Promise<OpsStatus> {
  const dir = deps.opsDir;
  if (!dir) return { configured: false, agent: { seen_at: null, alive: false }, version: null, jobs: [] };
  const beat = await readKv(join(dir, 'agent'));
  const seen = beat?.at ? Number(beat.at) * 1000 : null;
  let version: OpsVersion | null = null;
  const v = await readKv(join(dir, 'version'));
  if (v?.commit) {
    const pending = Object.entries(v).filter(([k]) => k.startsWith('pending_')).sort(([a], [b]) => Number(a.slice(8)) - Number(b.slice(8)))
      .map(([, line]) => ({ commit: line.slice(0, 12), subject: line.slice(13) }));
    version = { commit: v.commit, subject: v.subject ?? '', date: v.date ?? '', branch: v.branch ?? '', behind: Number(v.behind ?? 0), pending, checked_at: iso(v.checked_at) ?? '' };
  }
  const jobs: OpsJob[] = [];
  for (const sub of ['jobs', 'requests'] as const) {
    let names: string[] = [];
    try { names = await fs.readdir(join(dir, sub)); } catch { /* not there yet */ }
    for (const name of names) {
      const id = name.replace(/\.(state|req)$/, '');
      if (!ID.test(id) || !name.endsWith(sub === 'jobs' ? '.state' : '.req')) continue;
      if (sub === 'requests' && jobs.some((j) => j.id === id)) continue;
      const kv = await readKv(join(dir, sub, name));
      if (!kv) continue;
      jobs.push({
        id, action: kv.action as OpsAction, service: kv.service || null, by: kv.by || null,
        state: sub === 'requests' ? 'queued' : (['running', 'done', 'failed'].includes(kv.state ?? '') ? kv.state as OpsJob['state'] : 'running'),
        requested_at: iso(kv.requested_at), started_at: iso(kv.started_at), finished_at: iso(kv.finished_at),
      });
    }
  }
  jobs.sort((a, b) => (b.requested_at ?? '').localeCompare(a.requested_at ?? ''));
  // The heartbeat is the host's wall clock, so it is compared with the real time, not deps.now.
  return { configured: true, agent: { seen_at: seen ? new Date(seen).toISOString() : null, alive: !!seen && Date.now() - seen < AGENT_ALIVE_MS }, version, jobs: jobs.slice(0, 20) };
}

export async function requestOp(deps: AppDeps, who: SessionUser, input: { action: OpsAction; service?: string; password?: string }, ctx: Ctx): Promise<{ id: string }> {
  const dir = deps.opsDir;
  if (!dir) throw new ApiError(409, 'ops_off', 'Updating and restarting from the console is not set up on this server. See docs/19.');
  if (input.action === 'restart' && !OPS_SERVICES.includes(input.service as typeof OPS_SERVICES[number])) throw new ApiError(400, 'bad_service', 'Pick a service to restart.');
  // Checking for updates changes nothing; restarting and updating ask for the password again.
  if (input.action !== 'check') {
    const u = await deps.db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [who.userId]);
    if (!(await verifyPassword(u.rows[0]!.password_hash, input.password ?? ''))) throw new ApiError(400, 'wrong_password', 'That is not your password.');
  }
  const status = await opsStatus(deps);
  if (input.action !== 'check' && status.jobs.some((j) => j.state === 'queued' || j.state === 'running')) {
    throw new ApiError(409, 'ops_busy', 'Another job is still running. Wait for it to finish.');
  }
  const id = newId('op');
  const service = input.action === 'restart' ? input.service! : '';
  const body = [`action=${input.action}`, `service=${service}`, `by=${who.handle}`, `requested_at=${Math.floor(deps.now() / 1000)}`, ''].join('\n');
  await fs.mkdir(join(dir, 'requests'), { recursive: true });
  // Written under a temporary name and renamed, so the agent never reads half a file.
  await fs.writeFile(join(dir, 'requests', `.${id}.tmp`), body, { mode: 0o644 });
  await fs.rename(join(dir, 'requests', `.${id}.tmp`), join(dir, 'requests', `${id}.req`));
  await audit(deps.db, { actorId: who.userId, actorKind: 'user', action: `ops.${input.action}`, targetType: 'ops', targetId: id, after: { service: service || null }, origin: 'console', ipHash: ctx.ipHash });
  return { id };
}

export async function opsLog(deps: AppDeps, id: string): Promise<{ log: string; truncated: boolean }> {
  if (!deps.opsDir || !ID.test(id)) throw new ApiError(404, 'not_found', 'No such job.');
  let buf: Buffer;
  try { buf = await fs.readFile(join(deps.opsDir, 'jobs', `${id}.log`)); } catch { return { log: '', truncated: false }; }
  const truncated = buf.length > LOG_TAIL_BYTES;
  return { log: buf.subarray(Math.max(0, buf.length - LOG_TAIL_BYTES)).toString('utf8'), truncated };
}
