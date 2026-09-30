import { ircChannelName } from '@app/shared';
import { audit } from '../audit';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import type { Ctx, SessionUser } from '../accounts';
import { ergoChannels } from './api';
import { ircSyncSoon } from './hook';
import { ringChannel } from './sync';

export interface ChannelView { name: string; kind: 'official' | 'ring' | 'user'; owner: string | null; ring: { slug: string; name: string } | null; users: number | null; topic: string | null }

// The registered channels, for the Chat app's channel list (docs/08). Live user counts come from Ergo when it answers.
export async function listChannels(deps: AppDeps): Promise<ChannelView[]> {
  const live = new Map<string, { users: number; topic: string }>();
  if (deps.irc) {
    try { for (const c of await ergoChannels(deps.irc)) live.set(c.name.toLowerCase(), { users: c.userCount, topic: c.topic }); } catch { /* Ergo down: counts are unknown */ }
  }
  const withLive = (v: Omit<ChannelView, 'users' | 'topic'>): ChannelView => ({ ...v, users: live.get(v.name)?.users ?? (deps.irc ? 0 : null), topic: live.get(v.name)?.topic || null });
  const out: ChannelView[] = [];
  const official = new Set(deps.config.irc.official_channels);
  const rows = await deps.db.query<{ name: string; kind: 'official' | 'user'; owner: string | null }>(
    `SELECT c.name, c.kind, u.handle AS owner FROM irc_channels c LEFT JOIN users u ON u.id = c.owner_id
     WHERE c.removed_at IS NULL AND (c.kind = 'official' OR u.status = 'active') ORDER BY c.name`);
  for (const r of rows.rows) if (r.kind === 'official') official.add(r.name);
  for (const name of official) out.push(withLive({ name, kind: 'official', owner: null, ring: null }));
  const rings = await deps.db.query<{ slug: string; name: string }>(`SELECT slug, name FROM rings WHERE archived_at IS NULL AND hidden_at IS NULL ORDER BY slug`);
  for (const r of rings.rows) out.push(withLive({ name: ringChannel(r.slug), kind: 'ring', owner: null, ring: { slug: r.slug, name: r.name } }));
  for (const r of rows.rows) if (r.kind === 'user' && !official.has(r.name)) out.push(withLive({ name: r.name, kind: 'user', owner: r.owner, ring: null }));
  return out;
}

function checkName(deps: AppDeps, raw: string): string {
  const name = raw.trim().toLowerCase();
  const parsed = ircChannelName.safeParse(name);
  if (!parsed.success) throw new ApiError(400, 'bad_name', 'A channel name is # followed by up to 30 lowercase letters, digits, - or _.');
  if (name.startsWith('#ring-')) throw new ApiError(400, 'bad_name', 'Names starting with #ring- are kept for ring channels.');
  if (deps.config.irc.official_channels.includes(name)) throw new ApiError(409, 'name_taken', 'That channel is already registered.');
  return name;
}

async function insertChannel(deps: AppDeps, actor: SessionUser, name: string, kind: 'official' | 'user', ctx: Ctx, reason?: string): Promise<void> {
  await deps.db.tx(async (q) => {
    const existing = await q.query<{ removed_at: Date | null }>(`SELECT removed_at FROM irc_channels WHERE name = $1 FOR UPDATE`, [name]);
    if (existing.rows[0] && !existing.rows[0].removed_at) throw new ApiError(409, 'name_taken', 'That channel is already registered.');
    if (kind === 'user' && actor.role !== 'admin') {
      const quota = deps.config.limits.trusted_channel_quota;
      const n = Number((await q.query<{ n: string }>(`SELECT count(*) AS n FROM irc_channels WHERE owner_id = $1 AND removed_at IS NULL`, [actor.userId])).rows[0]!.n);
      if (n >= quota) throw new ApiError(409, 'quota_reached', quota === 0 ? 'Registering channels is turned off on this site.' : `You can register up to ${quota} channels. Remove one to register another.`);
    }
    const owner = kind === 'user' ? actor.userId : null;
    if (existing.rows[0]) await q.query(`UPDATE irc_channels SET kind = $2, owner_id = $3, created_by = $4, created_at = now(), removed_at = NULL WHERE name = $1`, [name, kind, owner, actor.userId]);
    else await q.query(`INSERT INTO irc_channels (name, kind, owner_id, created_by) VALUES ($1, $2, $3, $4)`, [name, kind, owner, actor.userId]);
    await audit(q, { actorId: actor.userId, actorKind: 'user', action: 'irc.channel_registered', targetType: 'irc_channel', targetId: name, after: { kind, reason }, origin: 'web', ipHash: ctx.ipHash });
  });
  ircSyncSoon();
}

// Trusted users register their own channels within a quota; admins without one (Q5, decided 2026-09-30).
export async function registerChannel(deps: AppDeps, user: SessionUser, raw: string, ctx: Ctx): Promise<{ name: string }> {
  if (user.role !== 'trusted' && user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only trusted users can register channels. Anyone can still join or start an unregistered one.');
  const name = checkName(deps, raw);
  await insertChannel(deps, user, name, 'user', ctx);
  return { name };
}

export async function registerOfficial(deps: AppDeps, admin: SessionUser, raw: string, reason: string, ctx: Ctx): Promise<{ name: string }> {
  const name = checkName(deps, raw);
  await insertChannel(deps, admin, name, 'official', ctx, reason);
  return { name };
}

export async function removeChannel(deps: AppDeps, actor: SessionUser, raw: string, ctx: Ctx, reason?: string): Promise<void> {
  const name = raw.trim().toLowerCase();
  await deps.db.tx(async (q) => {
    const r = await q.query<{ kind: string; owner_id: string | null }>(`SELECT kind, owner_id FROM irc_channels WHERE name = $1 AND removed_at IS NULL FOR UPDATE`, [name]);
    const c = r.rows[0];
    if (!c) throw new ApiError(404, 'not_found', 'No such registered channel.');
    const mine = c.owner_id === actor.userId;
    if (!mine && actor.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only its owner or an admin can remove that channel.');
    if (!mine && !reason) throw new ApiError(400, 'reason_required', 'Give a reason.');
    await q.query(`UPDATE irc_channels SET removed_at = now() WHERE name = $1`, [name]);
    await audit(q, { actorId: actor.userId, actorKind: 'user', action: 'irc.channel_removed', targetType: 'irc_channel', targetId: name, after: reason ? { reason } : undefined, origin: 'web', ipHash: ctx.ipHash });
  });
  ircSyncSoon();
}
