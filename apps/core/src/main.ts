import { buildApp } from './app';
import { depsFromEnv } from './env';
import { pruneOutbox, redisBus, startRelay, type Relay } from './events';
import { migrate } from './migrate';
import { startExportWorker } from './exports/service';
import { loadSettings } from './settings';
import { startMetricsCollector } from './metrics';
import { startIrcSync, type IrcSync } from './irc/sync';

// Events that change what IRC should look like (docs/02 provisioning table).
const IRC_EVENTS = new Set(['user.created', 'user.role_changed', 'user.ops_changed', 'user.renamed', 'user.deleted', 'user.suspended', 'user.unsuspended', 'ring.created', 'ring.member_changed']);

function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

async function start() {
  const deps = depsFromEnv();
  await migrate(deps.db, console.log);
  await loadSettings(deps); // saved settings go over the config file's values
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

  const exportWorker = startExportWorker(deps, (m) => app.log.warn(m));
  const metrics = startMetricsCollector(deps, (m) => app.log.warn(m));

  // IRC: the bot keeps Ergo matching core. Events make it act within a moment; it also checks every 30 s.
  let ircSync: IrcSync | undefined;
  const stopEvents = new AbortController();
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
    await app.close();
    metrics.stop();
    stopEvents.abort();
    ircSync?.stop();
    await exportWorker.stop();
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
