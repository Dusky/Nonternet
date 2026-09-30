// Who is here right now, across front doors (docs/10 "Who's online", docs/04). Kept in memory: web visits
// (a session used in the last 5 minutes), the BBS's nodes as it last reported them, and IRC accounts from
// the sync bot. One core process holds it; after a restart it fills again within a minute.
const WEB_WINDOW_MS = 5 * 60_000;
const BBS_STALE_MS = 30_000;
const web = new Map<string, number>(); // user id → last seen (ms)
export interface BbsNodeState { node: number; user_id: string; via: 'telnet' | 'ssh' | 'web'; where: string; since: string }
let bbs: { at: number; nodes: BbsNodeState[] } = { at: 0, nodes: [] };

export function noteWebSeen(userId: string, now = Date.now()): void {
  web.set(userId, now);
  if (web.size > 50_000) for (const [k, t] of web) if (now - t > WEB_WINDOW_MS) web.delete(k);
}
export function setBbsNodes(nodes: BbsNodeState[], now = Date.now()): void { bbs = { at: now, nodes }; }
export function bbsNodes(now = Date.now()): BbsNodeState[] { return now - bbs.at > BBS_STALE_MS ? [] : bbs.nodes; }
export function webOnline(now = Date.now()): string[] {
  return [...web].filter(([, t]) => now - t <= WEB_WINDOW_MS).map(([id]) => id);
}
