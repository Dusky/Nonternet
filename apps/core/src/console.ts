import { ROLES, type ConsoleCommandSpec, type ConsoleResult, type Role } from '@app/shared';
import { audit } from './audit';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import type { Ctx, SessionUser } from './accounts';
import * as admin from './admin';
import { createAnnouncement } from './announcements';
import { updateBoard } from './boards';
import * as files from './files';
import { listReports } from './moderation';
import { stats } from './stats';
import * as vouches from './vouches';

// The command console (docs/11 §11). Each command is the same core function a console button calls, with
// the same checks and the same audit entries; the console adds one more entry, `console.command`, with
// the command as typed. Nothing here is a back door: an admin can do exactly what the buttons allow.

type Args = { pos: string[]; flags: Record<string, string | true> };
interface Command extends ConsoleCommandSpec { run(deps: AppDeps, v: SessionUser, a: Args, ctx: Ctx): Promise<ConsoleResult> }

// Words, "quoted words" and --flags (--flag value, --flag=value, or a bare --flag).
export function parseCommand(line: string): Args & { words: string[] } {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) tokens.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]!);
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith('--') && t.length > 2) {
      const [k, v] = t.slice(2).split(/=(.*)/s, 2);
      if (v !== undefined) flags[k!] = v;
      else if (tokens[i + 1] !== undefined && !tokens[i + 1]!.startsWith('--')) flags[k!] = tokens[++i]!;
      else flags[k!] = true;
    } else pos.push(t);
  }
  return { words: tokens, pos, flags };
}

const usage = (c: ConsoleCommandSpec) => new ApiError(400, 'usage', `Usage: ${c.usage}`);
const text = (...lines: string[]): ConsoleResult => ({ lines });
const reasonOf = (a: Args, c: ConsoleCommandSpec, required = true): string | undefined => {
  const r = typeof a.flags.reason === 'string' ? a.flags.reason.trim() : '';
  if (required && r.length < 3) throw new ApiError(400, 'reason_required', `Give a reason: ${c.usage}`);
  return r || undefined;
};
async function userByHandle(deps: AppDeps, handle: string | undefined, c: ConsoleCommandSpec): Promise<{ id: string; handle: string }> {
  if (!handle) throw usage(c);
  const r = await deps.db.query<{ id: string; handle: string }>(`SELECT id, handle FROM users WHERE lower(handle) = lower($1) AND status <> 'deleted'`, [handle.replace(/^@/, '')]);
  if (!r.rows[0]) throw new ApiError(404, 'not_found', `No user called ${handle}.`);
  return r.rows[0];
}

const COMMANDS: Command[] = [
  { name: 'help', usage: 'help [command]', summary: 'List commands, or explain one.', args: ['command'],
    async run(_d, _v, a) {
      const want = a.pos.join(' ');
      if (want) {
        const c = COMMANDS.find((x) => x.name === want || x.name.startsWith(`${want} `));
        if (!c) throw new ApiError(404, 'unknown_command', `No command called ${want}. Type help for the list.`);
        return text(c.usage, c.summary);
      }
      return { lines: ['Commands:'], table: { columns: ['command', 'what it does'], rows: COMMANDS.map((c) => [c.usage, c.summary]) } };
    } },
  { name: 'stats', usage: 'stats', summary: 'Totals and today’s active people.', args: [],
    async run(d) {
      const s = await stats(d, { days: 7, weeks: 2 });
      const t = s.days.at(-1)!;
      return { lines: [`Active today ${t.dau}, this week ${t.wau}, this month ${t.mau}.`], table: { columns: ['what', 'how many'], rows: Object.entries(s.totals).map(([k, v]) => [k.replace('_', ' '), String(v)]) } };
    } },
  { name: 'user show', usage: 'user show <handle>', summary: 'A person’s role, status and recent history.', args: ['handle'],
    async run(d, _v, a) {
      const u = await userByHandle(d, a.pos[0], this);
      const x = await admin.getDossier(d, u.id);
      return { lines: [`${x.user.handle} (${x.user.id}): ${x.user.role}, ${x.user.status}, joined ${x.user.created_at?.slice(0, 10)}, last seen ${x.user.last_seen_at?.slice(0, 10) ?? 'never'}`],
        table: { columns: ['when', 'action', 'by'], rows: x.history.slice(0, 10).map((h) => [h.at.slice(0, 16).replace('T', ' '), h.action, h.actor_handle ?? h.actor_kind]) } };
    } },
  { name: 'user role', usage: 'user role <handle> <guest|user|trusted|admin> --reason "…"', summary: 'Change someone’s role.', args: ['handle', 'role'],
    async run(d, v, a, ctx) {
      const u = await userByHandle(d, a.pos[0], this);
      const role = a.pos[1] as Role;
      if (!ROLES.includes(role)) throw usage(this);
      const r = await admin.setRole(d, v, u.id, role, reasonOf(a, this)!, ctx);
      return text(`${u.handle} is now ${r.role}.`);
    } },
  { name: 'user suspend', usage: 'user suspend <handle> --reason "…"', summary: 'Suspend someone and sign them out everywhere.', args: ['handle'],
    async run(d, v, a, ctx) { const u = await userByHandle(d, a.pos[0], this); await admin.suspend(d, v, u.id, reasonOf(a, this)!, ctx); return text(`${u.handle} is suspended.`); } },
  { name: 'user unsuspend', usage: 'user unsuspend <handle> --reason "…"', summary: 'Lift a suspension.', args: ['handle'],
    async run(d, v, a, ctx) { const u = await userByHandle(d, a.pos[0], this); await admin.unsuspend(d, v, u.id, reasonOf(a, this)!, ctx); return text(`${u.handle} can sign in again.`); } },
  { name: 'user rename', usage: 'user rename <handle> <new-handle> --reason "…"', summary: 'Change someone’s handle.', args: ['handle', 'new'],
    async run(d, v, a, ctx) {
      const u = await userByHandle(d, a.pos[0], this);
      if (!a.pos[1]) throw usage(this);
      const r = await admin.renameUser(d, v, u.id, a.pos[1], reasonOf(a, this)!, ctx);
      return text(`${u.handle} is now ${r.handle}.`);
    } },
  { name: 'announce', usage: 'announce "<message>" [--title "…"] [--warning] [--irc] [--mud]', summary: 'Put up an announcement now.', args: ['message'],
    async run(d, v, a, ctx) {
      const body = a.pos.join(' ').trim();
      if (!body) throw usage(this);
      const title = typeof a.flags.title === 'string' ? a.flags.title : 'Announcement';
      const r = await createAnnouncement(d, v, { title, body, level: a.flags.warning ? 'warning' : 'info', irc: !!a.flags.irc, mud: !!a.flags.mud }, ctx);
      return text(`Announced: ${r.title}.`);
    } },
  { name: 'board archive', usage: 'board archive <slug>', summary: 'Archive a board: readable, closed to new posts.', args: ['board'],
    async run(d, v, a, ctx) { if (!a.pos[0]) throw usage(this); const b = await updateBoard(d, v, a.pos[0], { archived: true }, ctx); return text(`${b.name} is archived.`); } },
  { name: 'board unarchive', usage: 'board unarchive <slug>', summary: 'Bring an archived board back.', args: ['board'],
    async run(d, v, a, ctx) { if (!a.pos[0]) throw usage(this); const b = await updateBoard(d, v, a.pos[0], { archived: false }, ctx); return text(`${b.name} is open again.`); } },
  { name: 'reports', usage: 'reports [--all]', summary: 'The report queue.', args: [],
    async run(d, v, a) {
      const r = await listReports(d, v, { status: a.flags.all ? 'all' : 'open', limit: 25 });
      if (!r.reports.length) return text('No reports.');
      return { lines: [], table: { columns: ['when', 'what', 'about', 'category', 'status'], rows: r.reports.map((x) => [x.at.slice(0, 16).replace('T', ' '), x.target.type, x.target.handle ?? x.board.name, x.category, x.status]) } };
    } },
  { name: 'vouches', usage: 'vouches', summary: 'People waiting for trusted, with their vouches.', args: [],
    async run(d) {
      const c = await vouches.listCandidates(d);
      if (!c.length) return text('Nobody is waiting.');
      return { lines: [], table: { columns: ['person', 'vouched by', 'ready'], rows: c.map((x) => [x.user.handle, x.vouches.map((y) => y.voucher.handle).join(', '), x.ready ? 'yes' : 'no']) } };
    } },
  { name: 'vouch confirm', usage: 'vouch confirm <handle> [--reason "…"]', summary: 'Make a vouched-for person trusted.', args: ['handle'],
    async run(d, v, a, ctx) { const u = await userByHandle(d, a.pos[0], this); await vouches.confirm(d, v, u.id, reasonOf(a, this, false), ctx); return text(`${u.handle} is now trusted.`); } },
  { name: 'vouch decline', usage: 'vouch decline <handle> --reason "…"', summary: 'Decline the vouches for someone.', args: ['handle'],
    async run(d, v, a, ctx) { const u = await userByHandle(d, a.pos[0], this); await vouches.decline(d, v, u.id, reasonOf(a, this)!, ctx); return text(`Declined the vouches for ${u.handle}.`); } },
  { name: 'file hide', usage: 'file hide <file-id> --reason "…"', summary: 'Hide a file in the file areas.', args: ['file'],
    async run(d, v, a, ctx) { if (!a.pos[0]) throw usage(this); await files.setHidden(d, v, a.pos[0], true, reasonOf(a, this)!, ctx); return text('Hidden.'); } },
  { name: 'file unhide', usage: 'file unhide <file-id> --reason "…"', summary: 'Show a hidden file again.', args: ['file'],
    async run(d, v, a, ctx) { if (!a.pos[0]) throw usage(this); await files.setHidden(d, v, a.pos[0], false, reasonOf(a, this)!, ctx); return text('Shown again.'); } },
  { name: 'audit', usage: 'audit [--action user.*] [--limit 20]', summary: 'The latest audit entries.', args: [],
    async run(d, _v, a) {
      const limit = Math.min(Number(a.flags.limit) || 20, 100);
      const r = await admin.listAudit(d, { action: typeof a.flags.action === 'string' ? a.flags.action : undefined, limit });
      return { lines: [], table: { columns: ['when', 'action', 'by', 'target'], rows: r.entries.map((e) => [e.at.slice(0, 16).replace('T', ' '), e.action, e.actor_handle ?? e.actor_kind, e.target_id ?? '']) } };
    } },
];

export const commandSpecs = (): ConsoleCommandSpec[] => COMMANDS.map(({ name, usage: u, summary, args }) => ({ name, usage: u, summary, args }));

// Two-word commands first ("user show"), then one word ("stats").
function find(words: string[]): { cmd: Command; rest: number } | null {
  const two = COMMANDS.find((c) => c.name === `${words[0]} ${words[1]}`);
  if (two) return { cmd: two, rest: 2 };
  const one = COMMANDS.find((c) => c.name === words[0]);
  return one ? { cmd: one, rest: 1 } : null;
}

export async function runCommand(deps: AppDeps, v: SessionUser, line: string, ctx: Ctx): Promise<ConsoleResult> {
  if (v.role !== 'admin') throw new ApiError(403, 'forbidden', 'The command console is for admins.');
  const parsed = parseCommand(line.trim());
  if (!parsed.words.length) return text();
  const hit = find(parsed.pos);
  let outcome: 'ok' | 'error' = 'ok';
  let message: string | null = null;
  try {
    if (!hit) {
      const group = COMMANDS.filter((c) => c.name.startsWith(`${parsed.pos[0]} `));
      throw new ApiError(404, 'unknown_command', group.length ? `Try one of: ${group.map((c) => c.name).join(', ')}.` : `No command called ${parsed.pos[0] ?? line}. Type help for the list.`);
    }
    return await hit.cmd.run(deps, v, { pos: parsed.pos.slice(hit.rest), flags: parsed.flags }, ctx);
  } catch (e) {
    outcome = 'error';
    message = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    // Read-only commands are audited too: the console is a power tool and admins should see how it was used.
    await audit(deps.db, { actorId: v.userId, actorKind: 'user', action: 'console.command',
      after: { command: line.trim().slice(0, 500), outcome, message }, origin: 'console', ipHash: ctx.ipHash }).catch(() => undefined);
  }
}
