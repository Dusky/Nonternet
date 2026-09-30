import { audit } from '../audit';
import type { AppDeps } from '../deps';
import { ApiError } from '../errors';
import type { Ctx, SessionUser } from '../accounts';
import { ergoChannels, ergoStatus, type ErgoChannel, type ErgoStatus } from './api';
import { currentSync } from './hook';
import { ircOnline, type SyncReport } from './sync';

export interface IrcOverview {
  configured: boolean; bot_connected: boolean; reachable: boolean;
  status: ErgoStatus | null; channels: ErgoChannel[]; online: string[]; last_sync: SyncReport | null;
}

// The console's IRC page (docs/11): server health, live channels and who is on.
export async function overview(deps: AppDeps): Promise<IrcOverview> {
  const sync = currentSync();
  const base: IrcOverview = { configured: Boolean(deps.irc), bot_connected: Boolean(sync?.bot.ready), reachable: false, status: null, channels: [], online: ircOnline().accounts, last_sync: sync?.lastReport() ?? null };
  if (!deps.irc) return base;
  try {
    const [status, channels] = await Promise.all([ergoStatus(deps.irc), ergoChannels(deps.irc)]);
    return { ...base, reachable: true, status, channels: channels.sort((a, b) => b.userCount - a.userCount || a.name.localeCompare(b.name)) };
  } catch {
    return base;
  }
}

function bot() {
  const s = currentSync();
  if (!s?.bot.ready) throw new ApiError(503, 'irc_unavailable', 'The site is not connected to the IRC server right now.');
  return s.bot;
}

// Disconnects every session using that nick. For anything longer, suspend the account or ban an address.
export async function disconnect(deps: AppDeps, admin: SessionUser, nick: string, reason: string, ctx: Ctx): Promise<void> {
  const n = await bot().call(`KILL ${nick} :${reason}`);
  if (n.some((x) => /no such nick|no_such_nick/i.test(x))) throw new ApiError(404, 'not_found', 'Nobody with that nick is connected.');
  await audit(deps.db, { actorId: admin.userId, actorKind: 'user', action: 'irc.disconnected', targetType: 'irc_nick', targetId: nick, after: { reason }, origin: 'web', ipHash: ctx.ipHash });
}

// Address bans (Ergo's UBAN on an IP or network). Account bans are site suspensions, so core stays the one place they live.
export async function listBans(): Promise<string[]> {
  return (await bot().call('UBAN LIST')).filter((l) => !/^There are \d+ active/i.test(l) && !/may also be prevented/i.test(l));
}

export async function addBan(deps: AppDeps, admin: SessionUser, target: string, duration: string | undefined, reason: string, ctx: Ctx): Promise<void> {
  const n = await bot().call(`UBAN ADD ${target}${duration ? ` DURATION ${duration}` : ''} ${reason}`);
  if (!n.some((x) => /successfully added uban/i.test(x))) throw new ApiError(400, 'ban_failed', n.find((x) => x) ?? 'The IRC server did not accept that ban.');
  await audit(deps.db, { actorId: admin.userId, actorKind: 'user', action: 'irc.ban_added', targetType: 'irc_ban', targetId: target, after: { duration: duration ?? null, reason }, origin: 'web', ipHash: ctx.ipHash });
}

export async function removeBan(deps: AppDeps, admin: SessionUser, target: string, ctx: Ctx): Promise<void> {
  const n = await bot().call(`UBAN DEL ${target}`);
  if (!n.some((x) => /successfully removed/i.test(x))) throw new ApiError(404, 'not_found', n.find((x) => x) ?? 'There is no such ban.');
  await audit(deps.db, { actorId: admin.userId, actorKind: 'user', action: 'irc.ban_removed', targetType: 'irc_ban', targetId: target, origin: 'web', ipHash: ctx.ipHash });
}

export async function syncNow(): Promise<SyncReport | null> {
  bot();
  return currentSync()!.runNow({ full: true });
}
