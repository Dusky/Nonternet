import type { AppDeps } from './deps';
import { ircOnline } from './irc/sync';
import { bbsNodes, webOnline } from './presence';

// Who's online (docs/10, 04): one row per person, with where they are. IRC accounts are handles.
export async function online(deps: AppDeps) {
  const now = Date.now(); // presence is always real time, whatever clock the rest of core is given
  const nodes = bbsNodes(now);
  const webIds = webOnline(now);
  const irc = new Set(ircOnline().accounts);
  const ids = [...new Set([...webIds, ...nodes.map((n) => n.user_id)])];
  const r = await deps.db.query<{ id: string; handle: string; display_name: string | null }>(
    `SELECT id, handle, display_name FROM users WHERE (id = ANY($1) OR lower(handle) = ANY($2)) AND status = 'active' ORDER BY lower(handle)`, [ids, [...irc]]);
  const web = new Set(webIds);
  return r.rows.map((u) => {
    const n = nodes.find((x) => x.user_id === u.id);
    return { handle: u.handle, display_name: u.display_name, web: web.has(u.id), chat: irc.has(u.handle.toLowerCase()), bbs: n ? { node: n.node, where: n.where, via: n.via } : null };
  });
}
