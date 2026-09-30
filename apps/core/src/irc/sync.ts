import type { AppDeps } from '../deps';
import { ergoApi } from './api';
import { IrcBot, randomPassphrase } from './bot';
import { BOT_NICK } from './secrets';
import { setCurrentSync, setSyncHook } from './hook';

// Keeps Ergo matching core (docs/08). Core decides what should be true: which channels are
// registered, who is op where, which accounts are suspended. irc_applied records what the bot has
// already done, so each pass sends only the difference. A full pass re-sends everything, which
// repairs any drift. Events only make a pass happen sooner; nothing depends on seeing every event.

export interface Desired {
  channels: Map<string, { kind: 'official' | 'ring' | 'user'; topic?: string }>;
  amodes: Map<string, string>;  // "channel account" → mode letter
  suspended: Set<string>;       // account names (lowercase handles)
  release: Set<string>;         // old handles whose hold has run out: their Ergo accounts are removed
}

export const ringChannel = (slug: string) => `#ring-${slug}`;
const HOLD = `interval '90 days'`;

export async function desiredState(deps: AppDeps): Promise<Desired> {
  const channels: Desired['channels'] = new Map();
  const amodes: Desired['amodes'] = new Map();
  const official = new Set<string>(deps.config.irc.official_channels);
  const extra = await deps.db.query<{ name: string; kind: 'official' | 'user'; owner: string | null }>(
    `SELECT c.name, c.kind, lower(u.handle) AS owner FROM irc_channels c LEFT JOIN users u ON u.id = c.owner_id
     WHERE c.removed_at IS NULL AND (c.kind = 'official' OR u.status = 'active')`);
  for (const c of extra.rows) if (c.kind === 'official') official.add(c.name);
  const admins = (await deps.db.query<{ h: string }>(`SELECT lower(handle) AS h FROM users WHERE role = 'admin' AND status = 'active'`)).rows.map((r) => r.h);
  for (const name of official) {
    channels.set(name, { kind: 'official' });
    for (const a of admins) amodes.set(`${name} ${a}`, 'o');
  }
  for (const c of extra.rows) {
    if (c.kind !== 'user' || official.has(c.name)) continue;
    channels.set(c.name, { kind: 'user' });
    amodes.set(`${c.name} ${c.owner}`, 'q'); // the owner manages their own channel's ops through ChanServ
  }
  const rings = await deps.db.query<{ id: string; slug: string; name: string; description: string }>(
    `SELECT id, slug, name, description FROM rings WHERE archived_at IS NULL AND hidden_at IS NULL`);
  const ops = await deps.db.query<{ ring_id: string; h: string }>(
    `SELECT r.id AS ring_id, lower(u.handle) AS h FROM rings r JOIN users u ON u.id = r.founder_id WHERE u.status = 'active'
     UNION SELECT s.scope_id, lower(u.handle) FROM scoped_roles s JOIN users u ON u.id = s.user_id WHERE s.scope_type = 'ring' AND u.status = 'active'`);
  for (const r of rings.rows) {
    const name = ringChannel(r.slug);
    channels.set(name, { kind: 'ring', topic: r.description ? `${r.name}: ${r.description}` : r.name });
    for (const o of ops.rows) if (o.ring_id === r.id) amodes.set(`${name} ${o.h}`, 'o');
  }
  const suspended = new Set((await deps.db.query<{ h: string }>(
    `SELECT lower(handle) AS h FROM users WHERE status = 'suspended'
     UNION SELECT hh.handle FROM handle_history hh WHERE hh.changed_at > now() - ${HOLD}
       AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.handle) = hh.handle AND u.status = 'active')`)).rows.map((r) => r.h));
  const release = new Set((await deps.db.query<{ h: string }>(
    `SELECT DISTINCT hh.handle AS h FROM handle_history hh WHERE NOT EXISTS (SELECT 1 FROM handle_history x WHERE x.handle = hh.handle AND x.changed_at > now() - ${HOLD})
       AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.handle) = hh.handle)`)).rows.map((r) => r.h));
  for (const h of release) suspended.delete(h);
  return { channels, amodes, suspended, release };
}

type Applied = Map<string, string>;
async function applied(deps: AppDeps, kind: string): Promise<Applied> {
  const r = await deps.db.query<{ key: string; value: string }>(`SELECT key, value FROM irc_applied WHERE kind = $1`, [kind]);
  return new Map(r.rows.map((x) => [x.key, x.value]));
}
const record = (deps: AppDeps, kind: string, key: string, value = '') =>
  deps.db.query(`INSERT INTO irc_applied (kind, key, value) VALUES ($1, $2, $3) ON CONFLICT (kind, key) DO UPDATE SET value = $3, applied_at = now()`, [kind, key, value]);
const forget = (deps: AppDeps, kind: string, key: string) => deps.db.query(`DELETE FROM irc_applied WHERE kind = $1 AND key = $2`, [kind, key]);

const ok = (notices: string[], ...patterns: RegExp[]) => notices.some((n) => patterns.some((p) => p.test(n)));

export interface SyncReport { registered: string[]; unregistered: string[]; amodesSet: number; amodesRemoved: number; suspended: string[]; unsuspended: string[]; released: string[]; failures: string[] }

export async function reconcile(deps: AppDeps, bot: IrcBot, opts: { full?: boolean } = {}): Promise<SyncReport> {
  const irc = deps.irc!;
  const want = await desiredState(deps);
  const rep: SyncReport = { registered: [], unregistered: [], amodesSet: 0, amodesRemoved: 0, suspended: [], unsuspended: [], released: [], failures: [] };
  const lobby = deps.config.irc.official_channels[0]!;

  // Channels.
  const haveCh = await applied(deps, 'channel');
  for (const [name, c] of want.channels) {
    if (haveCh.has(name) && !opts.full) continue;
    await bot.joinAsOp(name);
    const n = await bot.call(`CS REGISTER ${name}`);
    if (!ok(n, /successfully registered/i, /already registered/i)) { rep.failures.push(`register ${name}: ${n.join(' / ')}`); continue; }
    if (c.topic && !haveCh.has(name)) await bot.call(`TOPIC ${name} :${c.topic}`);
    if (name !== lobby) await bot.call(`PART ${name}`); // the bot stays only in the lobby, for announcements
    await record(deps, 'channel', name, c.kind);
    if (c.kind === 'ring') await deps.db.query(`UPDATE rings SET irc_channel = $1 WHERE $1 = '#ring-' || slug AND irc_channel IS DISTINCT FROM $1`, [name]);
    if (!haveCh.has(name)) rep.registered.push(name);
  }
  for (const name of haveCh.keys()) {
    if (want.channels.has(name)) continue;
    const n = await bot.callConfirmed(`CS UNREGISTER ${name}`);
    if (!ok(n, /is now unregistered/i, /no such channel/i, /not registered/i)) { rep.failures.push(`unregister ${name}: ${n.join(' / ')}`); continue; }
    await forget(deps, 'channel', name);
    await deps.db.query(`DELETE FROM irc_applied WHERE kind = 'amode' AND key LIKE $1`, [`${name} %`]);
    await deps.db.query(`UPDATE rings SET irc_channel = NULL WHERE irc_channel = $1`, [name]);
    rep.unregistered.push(name);
  }

  // Who is op where.
  const haveAm = await applied(deps, 'amode');
  for (const [key, mode] of want.amodes) {
    if (haveAm.get(key) === mode && !opts.full) continue;
    const [channel, account] = key.split(' ') as [string, string];
    if (!want.channels.has(channel) || !(await applied(deps, 'channel')).has(channel)) continue;
    const old = haveAm.get(key);
    if (old && old !== mode) await bot.call(`CS AMODE ${channel} -${old} ${account}`);
    let n = await bot.call(`CS AMODE ${channel} +${mode} ${account}`);
    if (ok(n, /account does not exist/i)) {
      // They have not connected yet, so Ergo has no account for them. Make one (they still sign in
      // through core; this password is never used), then try again.
      await ergoApi(irc, 'ns/saregister', { accountName: account, passphrase: randomPassphrase() });
      n = await bot.call(`CS AMODE ${channel} +${mode} ${account}`);
    }
    if (!ok(n, /successfully set persistent mode/i, /no changes were made/i)) { rep.failures.push(`amode ${key} +${mode}: ${n.join(' / ')}`); continue; }
    await record(deps, 'amode', key, mode);
    rep.amodesSet++;
  }
  for (const [key, mode] of haveAm) {
    if (want.amodes.has(key)) continue;
    const [channel, account] = key.split(' ') as [string, string];
    const n = await bot.call(`CS AMODE ${channel} -${mode} ${account}`);
    if (!ok(n, /successfully set persistent mode/i, /no changes were made/i, /account does not exist/i, /not registered/i, /does not exist/i)) { rep.failures.push(`amode ${key} -${mode}: ${n.join(' / ')}`); continue; }
    await forget(deps, 'amode', key);
    rep.amodesRemoved++;
  }

  // Suspensions: suspended people, and old handles held for 90 days after a rename or deletion.
  const haveSu = await applied(deps, 'suspend');
  for (const account of want.suspended) {
    if (haveSu.has(account) && !opts.full) continue;
    const n = await bot.call(`NS SUSPEND ADD ${account} held by the site`);
    if (!ok(n, /successfully suspended/i, /no such account/i)) { rep.failures.push(`suspend ${account}: ${n.join(' / ')}`); continue; }
    await record(deps, 'suspend', account);
    if (!haveSu.has(account)) rep.suspended.push(account);
  }
  for (const account of haveSu.keys()) {
    if (want.suspended.has(account)) continue;
    await bot.call(`NS SUSPEND DEL ${account}`);
    await forget(deps, 'suspend', account);
    rep.unsuspended.push(account);
  }
  const released = await applied(deps, 'released');
  for (const account of want.release) {
    if (account === BOT_NICK || released.has(account)) continue;
    const n = await bot.callConfirmed(`NS SAUNREGISTER ${account}`);
    if (!ok(n, /unregistered/i, /no such account/i, /invalid account/i)) { rep.failures.push(`release ${account}: ${n.join(' / ')}`); continue; }
    await record(deps, 'released', account);
    rep.released.push(account);
  }
  // A released handle someone signs up with again starts over.
  for (const account of released.keys()) if (!want.release.has(account)) await forget(deps, 'released', account);
  return rep;
}

// Announcements an admin chose to send to IRC too, once each, when they go live.
export async function sendAnnouncements(deps: AppDeps, bot: IrcBot): Promise<number> {
  const lobby = deps.config.irc.official_channels[0]!;
  const r = await deps.db.query<{ id: string; title: string; body: string }>(
    `SELECT id, title, body FROM announcements WHERE 'irc' = ANY(channels) AND irc_sent_at IS NULL AND archived_at IS NULL
       AND starts_at <= to_timestamp($1 / 1000.0) AND (ends_at IS NULL OR ends_at > to_timestamp($1 / 1000.0)) ORDER BY starts_at`, [deps.now()]);
  for (const a of r.rows) {
    await bot.say(lobby, a.body ? `${a.title}: ${a.body}` : a.title);
    await deps.db.query(`UPDATE announcements SET irc_sent_at = now() WHERE id = $1`, [a.id]);
  }
  return r.rows.length;
}

// ---------------------------------------------------------------- presence

// Who is connected to IRC right now, by account. Kept in this process: one core instance serves the
// site (docs/01); with several, each would hold the same answer from its own bot.
const presence = { at: 0, accounts: new Set<string>() };
export const ircOnline = () => ({ at: presence.at ? new Date(presence.at).toISOString() : null, accounts: [...presence.accounts].sort() });

export async function refreshPresence(bot: IrcBot): Promise<void> {
  const users = await bot.who();
  presence.accounts = new Set(users.map((u) => (u.account && u.account !== '0' ? u.account.toLowerCase() : '')).filter((a) => a && a !== BOT_NICK));
  presence.at = Date.now();
}

// ---------------------------------------------------------------- the worker

export interface IrcSync { bot: IrcBot; soon(): void; runNow(opts?: { full?: boolean }): Promise<SyncReport | null>; stop(): void; lastReport: () => SyncReport | null }

export function startIrcSync(deps: AppDeps, log: (m: string) => void, opts: { tickMs?: number; fullEveryMs?: number; presenceMs?: number } = {}): IrcSync {
  const bot = new IrcBot(deps.irc!, log);
  let running: Promise<SyncReport | null> | null = null;
  let again = false;
  let last: SyncReport | null = null;
  let lastFull = 0;
  let stopped = false;

  const pass = async (full: boolean): Promise<SyncReport | null> => {
    if (!bot.ready) return null;
    const r = await reconcile(deps, bot, { full });
    await sendAnnouncements(deps, bot);
    if (r.failures.length) log(`irc sync: ${r.failures.length} change(s) did not apply: ${r.failures.slice(0, 3).join('; ')}`);
    last = r;
    return r;
  };
  const runNow = async (o: { full?: boolean } = {}): Promise<SyncReport | null> => {
    if (running) { again = true; await running; }
    const full = Boolean(o.full) || Date.now() - lastFull > (opts.fullEveryMs ?? 6 * 3_600_000);
    running = pass(full).catch((e) => { log(`irc sync: ${e instanceof Error ? e.message : String(e)}`); return null; });
    const r = await running;
    if (full && r) lastFull = Date.now();
    running = null;
    if (again && !stopped) { again = false; void runNow(); }
    return r;
  };
  let debounce: NodeJS.Timeout | undefined;
  const soon = () => { clearTimeout(debounce); debounce = setTimeout(() => void runNow(), 200); };

  bot.onReady = () => { log('irc sync: bot connected'); void runNow({ full: true }).then(() => refreshPresence(bot)); };
  const tick = setInterval(() => void runNow(), opts.tickMs ?? 30_000);
  const who = setInterval(() => void refreshPresence(bot).catch(() => undefined), opts.presenceMs ?? 20_000);
  let retry: NodeJS.Timeout | undefined;
  const start = () => bot.start().catch((e) => {
    log(`irc sync: could not start the bot, trying again in 5 s: ${e instanceof Error ? e.message : String(e)}`);
    if (!stopped) retry = setTimeout(start, 5000);
  });
  void start();
  setSyncHook(soon);
  const self: IrcSync = { bot, soon, runNow, lastReport: () => last, stop: () => undefined };
  self.stop = () => { stopped = true; clearTimeout(retry); setSyncHook(() => undefined); setCurrentSync(null); clearInterval(tick); clearInterval(who); clearTimeout(debounce); bot.stop(); };
  setCurrentSync(self);
  return self;
}
