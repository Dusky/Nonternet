import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import type { SiteConfig } from '@app/shared';
import type { Session } from './session';

// Door games (docs/04, PROPOSED). A door is a program the operator configures. For each caller the BBS
// makes a private folder, writes the drop files doors expect (DOOR32.SYS, DOOR.SYS), and runs the door with
// the caller's terminal on its stdin and stdout, in its own process group so the whole thing can be
// stopped. Doors can't reach core: they get the drop file and nothing else. VERIFY each door before
// offering it; DOS doors need an emulator (DOSEMU2, DOSBox-X) as their command.

export type Door = SiteConfig['bbs']['doors'][number];
const RANK = { guest: 0, user: 1, trusted: 2, admin: 3 } as Record<string, number>;
const LEVEL = { guest: 10, user: 20, trusted: 50, admin: 100 } as Record<string, number>;
const running = new Map<string, number>(); // door id → callers in it

export const inUse = (id: string) => running.get(id) ?? 0;
export const mayUse = (door: Door, role: string) => (RANK[role] ?? 0) >= RANK[door.min_role]!;

export interface DropInfo { node: number; handle: string; name: string; role: string; minutes: number; rows: number; lastCall: string | null }

const mmddyy = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`;
const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

// DOOR32.SYS: eleven lines (the Mystic/EleBBS format). Comm type 0 (local) because the door talks on stdio.
export function door32(i: DropInfo): string {
  return [0, 0, 38400, 'BBS 1.0', 1, i.name, i.handle, LEVEL[i.role] ?? 20, i.minutes, 1, i.node].join('\r\n') + '\r\n';
}

// DOOR.SYS: the 52-line GAP format. Fields the site has no notion of (phone numbers, conferences, file
// ratios) are filled with harmless values, as most BBSes do.
export function doorSys(i: DropInfo, now = new Date()): string {
  const last = i.lastCall ? new Date(i.lastCall) : now;
  return [
    'COM0:', '38400', '8', i.node, '38400', 'Y', 'Y', 'Y', 'Y', i.name, 'Online', '000-000-0000', '000-000-0000', '', LEVEL[i.role] ?? 20,
    1, mmddyy(last), i.minutes * 60, i.minutes, 'GR', i.rows, 'N', '', '', '12/31/99', 1, 'Z', 0, 0, 0, 999999, '01/01/80', '', '', 'Sysop',
    i.handle, '00:00', 'Y', 'Y', 'Y', 7, 0, mmddyy(now), hhmm(now), hhmm(last), 999, 0, 0, 0, '', 0, 0,
  ].join('\r\n') + '\r\n';
}

// Runs one door for one caller and resolves when it ends (exit, time limit, or the caller hanging up).
export function runDoor(s: Session, door: Door, wrapper: string[]): Promise<'exit' | 'time' | 'gone'> {
  const t = s.term;
  const dir = mkdtempSync(join(tmpdir(), `door-${door.id}-${s.node}-`));
  const info: DropInfo = { node: s.node, handle: s.user!.handle, name: s.user!.handle, role: s.user!.role, minutes: door.time_limit_minutes, rows: t.rows, lastCall: s.lastCall };
  if (door.dropfile !== 'door.sys') writeFileSync(join(dir, 'DOOR32.SYS'), door32(info));
  if (door.dropfile !== 'door32') writeFileSync(join(dir, 'DOOR.SYS'), doorSys(info));
  const dropfile = join(dir, door.dropfile === 'door.sys' ? 'DOOR.SYS' : 'DOOR32.SYS');
  const fillIn = (a: string) => a.replaceAll('{dropdir}', dir).replaceAll('{dropfile}', dropfile).replaceAll('{node}', String(s.node));
  const argv = [...wrapper, ...door.command].map(fillIn);
  running.set(door.id, inUse(door.id) + 1);
  return new Promise((resolve) => {
    // A small, fixed environment: the door learns nothing about the BBS beyond its drop file.
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: door.cwd ? fillIn(door.cwd) : dir, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, TERM: t.encoding === 'cp437' ? 'ansi' : 'xterm-256color', LINES: String(t.rows), COLUMNS: String(t.cols), LANG: 'C.UTF-8' },
    });
    let outcome: 'exit' | 'time' | 'gone' = 'exit';
    const kill = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ } setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, 2000).unref(); };
    const timer = setTimeout(() => { outcome = 'time'; kill(); }, door.time_limit_minutes * 60_000);
    // What the door writes, in the caller's character set.
    const toCaller = (b: Buffer) => {
      if (door.encoding === 'cp437' && t.encoding === 'utf8') t.writeRaw(Buffer.from(iconv.decode(b, 'cp437'), 'utf8'));
      else if (door.encoding === 'utf8' && t.encoding === 'cp437') t.writeRaw(iconv.encode(b.toString('utf8'), 'cp437'));
      else t.writeRaw(b);
    };
    child.stdout.on('data', toCaller);
    child.stderr.on('data', () => undefined);
    child.stdin.on('error', () => undefined);
    t.passthrough((b) => {
      if (door.encoding === 'cp437' && t.encoding === 'utf8') child.stdin.write(iconv.encode(b.toString('utf8'), 'cp437'));
      else child.stdin.write(b);
    });
    const onGone = setInterval(() => { if (t.closed) { outcome = 'gone'; kill(); } }, 500);
    const done = () => {
      clearTimeout(timer);
      clearInterval(onGone);
      t.passthrough(null);
      running.set(door.id, Math.max(0, inUse(door.id) - 1));
      rmSync(dir, { recursive: true, force: true });
      resolve(outcome);
    };
    child.on('error', (e) => { s.ctx.log(`door ${door.id}: ${e.message}`); t.line('That door would not start. The operator has been told.'); done(); });
    child.on('close', done);
  });
}
