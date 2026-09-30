import type { Core, NodeReport } from './core';

// Nodes (docs/04): each caller holds one numbered node while connected. The number of nodes and the
// callers per address are limited. Every few seconds the BBS tells core who is on which node; core answers
// who may stay, so a suspended or signed-out person is dropped within seconds, and roles stay current.

export interface NodeHolder {
  node: number;
  via: NodeReport['via'];
  ip: string;
  since: string;
  where: string;
  token: string | null;
  user: { id: string; handle: string; role: string } | null;
  drop(message: string): void;
  announce?(a: { id: string; title: string; body: string }): void;
}

export class Nodes {
  private held = new Map<number, NodeHolder>();
  private perIp = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly max: number, private readonly perIpMax: number) {}

  // A free node for a new connection from this address, or why not.
  claim(ip: string): { node: number } | { error: string } {
    if ((this.perIp.get(ip) ?? 0) >= this.perIpMax) return { error: `Too many connections from your address. Up to ${this.perIpMax} at once.` };
    for (let n = 1; n <= this.max; n++) {
      if (!this.held.has(n)) {
        this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
        return { node: n };
      }
    }
    return { error: 'All nodes are busy. Try again in a few minutes, or use the web.' };
  }

  attach(h: NodeHolder): void { this.held.set(h.node, h); }

  release(node: number, ip: string): void {
    this.held.delete(node);
    const n = (this.perIp.get(ip) ?? 1) - 1;
    if (n <= 0) this.perIp.delete(ip); else this.perIp.set(ip, n);
  }

  list(): NodeHolder[] { return [...this.held.values()].sort((a, b) => a.node - b.node); }

  // One round of reporting to core. Exported for tests; `start` runs it on a timer.
  async report(core: Core): Promise<void> {
    const live = this.list().filter((h) => h.token && h.user);
    const answer = await core.nodes(live.map((h) => ({ node: h.node, token: h.token!, via: h.via, where: h.where, since: h.since })));
    for (const a of answer.nodes) {
      const h = this.held.get(a.node);
      if (!h || !h.user) continue;
      if (!a.ok) h.drop('Your session has ended. If you think this is a mistake, contact the admins on the web.');
      else h.user.role = a.user.role;
    }
  }

  start(core: Core, everyMs = 3000, log: (m: string) => void = () => undefined): void {
    let busy = false;
    this.timer = setInterval(() => {
      if (busy) return;
      busy = true;
      this.report(core).catch((e) => log(`node report failed: ${e instanceof Error ? e.message : e}`)).finally(() => { busy = false; });
    }, everyMs);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); if (this.newsTimer) clearInterval(this.newsTimer); }

  // Live announcements go to everyone connected, once each.
  private newsTimer: NodeJS.Timeout | null = null;
  async announce(core: Core): Promise<void> {
    const r = await core.publicGet<{ announcements: { id: string; title: string; body: string }[] }>('/announcements');
    for (const a of r.announcements) for (const h of this.held.values()) h.announce?.(a);
  }
  startNews(core: Core, everyMs = 30_000): void {
    this.newsTimer = setInterval(() => void this.announce(core).catch(() => undefined), everyMs);
    this.newsTimer.unref?.();
  }
}
