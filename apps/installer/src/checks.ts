import { portsFor, servicesFor, type Answers } from './answers';

// What the installer looks at before it writes anything (docs/19). The probes are passed in, so the wizard uses the real
// machine and the tests use stand-ins. A failed check stops a headless install unless --force is given; the wizard shows
// it and lets the person go back and fix it.

export interface Probes {
  cpus(): number;
  memoryBytes(): number;
  diskFreeBytes(): Promise<number>;
  docker(): { docker: string | null; compose: string | null };   // versions, from sitectl on the host
  portFree(port: number): Promise<boolean>;                      // nothing on this machine is listening there
  resolve(name: string): Promise<string[]>;                      // A records
  publicIp(): Promise<string | null>;
  smtpGreets(url: string): Promise<boolean>;                     // the mail server answers with a 220 greeting
}
export type Level = 'ok' | 'warn' | 'fail';
export interface Check { id: string; level: Level; text: string }

const GB = 1024 ** 3;
const versionAtLeast = (v: string | null, want: number[]) => {
  if (!v) return false;
  const got = (/(\d+)\.(\d+)(?:\.(\d+))?/.exec(v) ?? []).slice(1).map((x) => Number(x ?? 0));
  for (let i = 0; i < want.length; i++) { if ((got[i] ?? 0) > want[i]!) return true; if ((got[i] ?? 0) < want[i]!) return false; }
  return true;
};

export async function runChecks(a: Answers, p: Probes, opts: { reinstall?: boolean } = {}): Promise<Check[]> {
  const out: Check[] = [];
  const add = (id: string, level: Level, text: string) => out.push({ id, level, text });
  const services = servicesFor(a);
  const busy = Object.values(services).filter(Boolean).length;

  // The machine.
  const cpus = p.cpus(); const mem = p.memoryBytes(); const disk = await p.diskFreeBytes();
  const wantMem = busy >= 4 ? 8 : 4;
  add('cpu', cpus >= 4 ? 'ok' : cpus >= 2 ? 'warn' : 'fail', `${cpus} CPU${cpus === 1 ? '' : 's'}${cpus >= 4 ? '' : ' (4 is a good start)'}`);
  add('memory', mem >= wantMem * GB * 0.9 ? 'ok' : mem >= 2 * GB ? 'warn' : 'fail', `${(mem / GB).toFixed(1)} GB of memory${mem >= wantMem * GB * 0.9 ? '' : ` (${wantMem} GB is a good start for what you chose)`}`);
  add('disk', disk >= 40 * GB ? 'ok' : disk >= 10 * GB ? 'warn' : 'fail', `${(disk / GB).toFixed(0)} GB free on disk${disk >= 40 * GB ? '' : ' (homepages, files and backups grow; 160 GB is comfortable)'}`);
  const d = p.docker();
  add('docker', d.docker ? 'ok' : 'fail', d.docker ? `Docker ${d.docker}` : 'Docker is not installed (https://docs.docker.com/engine/install/)');
  add('compose', versionAtLeast(d.compose, [2, 24]) ? 'ok' : 'fail', d.compose ? `Docker Compose ${d.compose}${versionAtLeast(d.compose, [2, 24]) ? '' : ' (2.24 or later is needed)'}` : 'Docker Compose v2 is not installed');

  // Ports: free now, unless the site is already running (then they are its own).
  for (const { port, what } of portsFor(services, a.ports.bbs_ssh_public)) {
    if (opts.reinstall) continue;
    const free = await p.portFree(port);
    add(`port-${port}`, free ? 'ok' : 'fail', free ? `port ${port} is free (${what})` : `port ${port} is in use by something else (${what})`);
  }

  // DNS: the names must point here before certificates can be issued.
  const me = await p.publicIp();
  const names = [a.site.domain, `check-dns.${a.site.homes_domain}`, ...(services.irc ? [`irc.${a.site.domain}`] : [])];
  for (const name of names) {
    const ips = await p.resolve(name).catch((): string[] => []);
    const shown = name.startsWith('check-dns.') ? `*.${a.site.homes_domain}` : name;
    if (!ips.length) add(`dns-${shown}`, 'warn', `${shown} does not point anywhere yet (needs an A record to this server)`);
    else if (me && !ips.includes(me)) add(`dns-${shown}`, 'warn', `${shown} points at ${ips.join(', ')}, but this server is ${me}`);
    else add(`dns-${shown}`, 'ok', `${shown} → ${ips.join(', ')}`);
  }

  // Mail: sign-ups and password resets need it.
  const greets = await p.smtpGreets(a.mail.smtp_url).catch(() => false);
  add('smtp', greets ? 'ok' : 'warn', greets ? 'the mail server answers' : 'the mail server did not answer (port 25 is often blocked; use a mail service on 587 or 465)');
  return out;
}

export const worst = (checks: Check[]): Level => (checks.some((c) => c.level === 'fail') ? 'fail' : checks.some((c) => c.level === 'warn') ? 'warn' : 'ok');
