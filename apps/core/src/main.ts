import { buildApp } from './app';
import { syncCatalog } from './apps';
import { depsFromEnv } from './env';
import { pruneOutbox, redisBus, startRelay, type Relay } from './events';
import { grantRuntimeRole, migrate, migrateWorker, quietLogger } from './migrate';
import { run as runJobs } from 'graphile-worker';
import { pushTask } from './push';
import { connect } from './db';
import { startExportWorker } from './exports/service';
import { loadSettings } from './settings';
import { startMetricsCollector } from './metrics';
import { startIrcSync, type IrcSync } from './irc/sync';
import { startMudSync } from './mud/sync';
import { sendDigests } from './personal';

// Events that change what IRC should look like (docs/02 provisioning table).
const MUD_EVENTS = new Set(['user.role_changed', 'user.ops_changed', 'user.renamed', 'user.deleted', 'user.suspended', 'user.unsuspended']);
const IRC_EVENTS = new Set(['user.created', 'user.role_changed', 'user.ops_changed', 'user.renamed', 'user.deleted', 'user.suspended', 'user.unsuspended', 'ring.created', 'ring.member_changed']);

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

async function start() {
  const deps = depsFromEnv();
  // With DB_RUNTIME_ROLE, migrations run as the owner (MIGRATION_DATABASE_URL) and core itself connects as the
  // runtime role, which cannot change the audit log (docs/15).
  if (process.env.MIGRATION_DATABASE_URL) {
    const owner = connect(process.env.MIGRATION_DATABASE_URL);
    try {
      await migrate(owner, console.log);
      await migrateWorker(owner);
      if (process.env.DB_RUNTIME_ROLE) await grantRuntimeRole(owner, process.env.DB_RUNTIME_ROLE, process.env.DB_RUNTIME_PASSWORD || undefined);
    } finally { await owner.end(); }
  } else {
    await migrate(deps.db, console.log);
    await migrateWorker(deps.db);
  }
  await loadSettings(deps); // saved settings go over the config file's values
  await syncCatalog(deps, console.log); // the installable apps in APPS_DIR (docs/10)
  const app = await buildApp(deps);

  // Events are always written to the outbox. With REDIS_URL set, the relay publishes them to the
  // bus. Without it they simply wait in the outbox (nothing is lost) until Redis is configured.
  let relay: Relay | undefined;
  let bus: ReturnType<typeof redisBus> | undefined;
  let prune: NodeJS.Timeout | undefined;
  if (process.env.REDIS_URL) {
    bus = redisBus(process.env.REDIS_URL);
    relay = startRelay({ db: deps.db, bus, log: (m) => app.log.warn(m) });
    prune = setInterval(() => pruneOutbox(deps.db).catch((e) => app.log.warn(`outbox prune: ${e}`)), 3_600_000);
  } else {
    app.log.warn('REDIS_URL is not set: events are kept in the outbox and not published');
  }

  // The daily digest for people who asked for one: checked hourly, at most one email each per day.
  const digests = setInterval(() => sendDigests(deps).catch((e) => app.log.warn(`digests: ${e}`)), 3_600_000);
  const exportWorker = startExportWorker(deps, (m) => app.log.warn(m));
  // Background jobs (graphile-worker, in Postgres): push notifications, each tried again with backoff if a push
  // service is down. Only started when push is on; other background work keeps its own simple loops (docs/17).
  const jobs = deps.push
    ? await runJobs({ pgPool: deps.db.pool, concurrency: 4, noHandleSignals: true, pollInterval: 2000, logger: quietLogger, taskList: { push_send: pushTask(deps) } })
    : undefined;
  const metrics = startMetricsCollector(deps, (m) => app.log.warn(m));
  const stopEvents = new AbortController();

  // MUD: core pushes account state to the MUD on changes and every five minutes (docs/09).
  const mudSync = deps.mud ? startMudSync(deps, (m) => app.log.warn(m)) : undefined;
  if (mudSync && bus) {
    void bus.subscribe({
      group: 'mud-sync', consumer: `core-${process.pid}`, signal: stopEvents.signal,
      handler: async (e) => { if (MUD_EVENTS.has(e.type)) mudSync.soon(); },
      onError: (err) => app.log.warn(`mud events: ${err instanceof Error ? err.message : String(err)}`),
    });
  }

  // IRC: the bot keeps Ergo matching core. Events make it act within a moment; it also checks every 30 s.
  let ircSync: IrcSync | undefined;
  if (deps.irc) {
    ircSync = startIrcSync(deps, (m) => app.log.warn(m));
    if (bus) {
      void bus.subscribe({
        group: 'irc-sync', consumer: `core-${process.pid}`, signal: stopEvents.signal,
        handler: async (e) => { if (IRC_EVENTS.has(e.type)) ircSync!.soon(); },
        onError: (err) => app.log.warn(`irc events: ${err instanceof Error ? err.message : String(err)}`),
      });
    }
  }

  // Finish in-flight requests, stop the relay, then close connections.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} received, shutting down`);
    if (prune) clearInterval(prune);
    clearInterval(digests);
    await app.close();
    metrics.stop();
    stopEvents.abort();
    ircSync?.stop();
    mudSync?.stop();
    await exportWorker.stop();
    await jobs?.stop();
    await relay?.stop();
    await bus?.close();
    await deps.db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}

start().catch(fail);
