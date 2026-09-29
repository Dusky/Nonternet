import { Redis } from 'ioredis';
import { eventPayloads, type DomainEvent, type EventPayload, type EventType } from '@app/shared';
import { newId } from './crypto';
import type { Db, Queryable } from './db';

// ---------------------------------------------------------------- writing events

// Record an event in the outbox. Call it with the SAME transaction as the change that caused it,
// so both commit or neither does. The relay (below) publishes it afterwards.
export async function emit<T extends EventType>(q: Queryable, type: T, payload: EventPayload<T>): Promise<void> {
  const parsed = eventPayloads[type].parse(payload); // a malformed event fails the transaction, loudly
  await q.query(`INSERT INTO events_outbox (event_id, type, payload) VALUES ($1, $2, $3)`, [newId('e'), type, JSON.stringify(parsed)]);
}

// ---------------------------------------------------------------- the bus

export interface SubscribeOptions {
  group: string;                 // consumer group: each group sees every event once
  consumer: string;              // this instance's name within the group
  handler: (event: DomainEvent) => Promise<void>;
  signal?: AbortSignal;          // aborts the loop
  from?: 'new' | 'start';        // a new group starts from new events (default) or the whole stream
  blockMs?: number;
  reclaimIdleMs?: number;        // an event unacknowledged this long is retried
  maxDeliveries?: number;        // after this many failed tries an event goes to the dead stream
  onError?: (err: unknown, event?: DomainEvent) => void;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(opts: SubscribeOptions): Promise<void>; // resolves when the signal aborts
  close(): Promise<void>;
}

const STREAM = 'events';
const DEAD = 'events:dead';
const MAX_LEN = 100_000;

export function redisBus(url: string, opts: { streamPrefix?: string } = {}): EventBus {
  const stream = `${opts.streamPrefix ?? ''}${STREAM}`;
  const dead = `${opts.streamPrefix ?? ''}${DEAD}`;
  const redis = new Redis(url, { maxRetriesPerRequest: null });
  const owned: Redis[] = [redis];

  return {
    async publish(event) {
      await redis.xadd(stream, 'MAXLEN', '~', MAX_LEN, '*', 'e', JSON.stringify(event));
    },

    async subscribe(o) {
      const blockMs = o.blockMs ?? 2000;
      const reclaimIdle = o.reclaimIdleMs ?? 60_000;
      const maxDeliveries = o.maxDeliveries ?? 5;
      const onError = o.onError ?? (() => undefined);
      // A blocking read needs its own connection.
      const conn = new Redis(url, { maxRetriesPerRequest: null });
      owned.push(conn);
      try {
        await conn.xgroup('CREATE', stream, o.group, o.from === 'start' ? '0' : '$', 'MKSTREAM');
      } catch (err) {
        if (!String(err).includes('BUSYGROUP')) throw err;
      }

      type Entry = [string, string[]];
      const parse = (entry: Entry): DomainEvent | null => {
        try {
          return JSON.parse(entry[1][entry[1].indexOf('e') + 1]!) as DomainEvent;
        } catch {
          return null;
        }
      };

      const handle = async (entry: Entry, deliveries: number) => {
        const event = parse(entry);
        if (!event) {
          await conn.xadd(dead, '*', 'id', entry[0], 'reason', 'unparseable');
          await conn.xack(stream, o.group, entry[0]);
          return;
        }
        try {
          await o.handler(event);
          await conn.xack(stream, o.group, entry[0]);
        } catch (err) {
          onError(err, event);
          if (deliveries >= maxDeliveries) {
            await conn.xadd(dead, '*', 'group', o.group, 'event', JSON.stringify(event), 'error', String(err).slice(0, 300));
            await conn.xack(stream, o.group, entry[0]);
          } // otherwise it stays pending and is retried after reclaimIdle
        }
      };

      // 1) our own unacknowledged events (a restart), 2) stuck events from others, 3) new events.
      const deliveriesOf = async (id: string): Promise<number> => {
        const p = (await conn.xpending(stream, o.group, id, id, 1)) as [string, string, number, number][];
        return p[0]?.[3] ?? 1;
      };
      while (!o.signal?.aborted) {
        try {
          const own = (await conn.xreadgroup('GROUP', o.group, o.consumer, 'COUNT', 50, 'STREAMS', stream, '0')) as [string, Entry[]][] | null;
          for (const entry of own?.[0]?.[1] ?? []) await handle(entry, await deliveriesOf(entry[0]));

          const claimed = (await conn.xautoclaim(stream, o.group, o.consumer, reclaimIdle, '0', 'COUNT', 50)) as [string, Entry[]];
          for (const entry of claimed[1] ?? []) await handle(entry, await deliveriesOf(entry[0]));

          const fresh = (await conn.xreadgroup('GROUP', o.group, o.consumer, 'COUNT', 50, 'BLOCK', blockMs, 'STREAMS', stream, '>')) as [string, Entry[]][] | null;
          for (const entry of fresh?.[0]?.[1] ?? []) await handle(entry, 1);
        } catch (err) {
          if (o.signal?.aborted) break;
          onError(err);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    },

    async close() {
      await Promise.all(owned.map((c) => c.quit().catch(() => undefined)));
    },
  };
}

// ---------------------------------------------------------------- the relay

export interface Relay { start(): void; stop(): Promise<void>; flush(): Promise<number> }

// Publishes outbox rows to the bus, oldest first. Several core instances can run a relay at once:
// SKIP LOCKED gives each a different batch. If publishing fails part-way, the events that did go
// out are marked and the rest are retried on the next pass (so a crash can duplicate, never lose).
export function createRelay(opts: { db: Db; bus: EventBus; intervalMs?: number; log?: (msg: string) => void }): Relay {
  const log = opts.log ?? (() => undefined);
  const interval = opts.intervalMs ?? 500;
  let stopped = true; // until start()
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<unknown> = Promise.resolve();

  async function flush(): Promise<number> {
    let sent = 0;
    let failure: unknown;
    await opts.db.tx(async (q) => {
      const rows = await q.query<{ id: string; event_id: string; type: EventType; payload: Record<string, unknown>; created_at: Date }>(
        `SELECT id, event_id, type, payload, created_at FROM events_outbox
          WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`);
      for (const r of rows.rows) {
        try {
          await opts.bus.publish({ id: r.event_id, type: r.type, at: new Date(r.created_at).toISOString(), payload: r.payload });
        } catch (err) {
          failure = err;
          break;
        }
        await q.query(`UPDATE events_outbox SET published_at = now() WHERE id = $1`, [r.id]);
        sent++;
      }
    });
    if (failure) throw failure;
    return sent;
  }

  const loop = async () => {
    if (stopped) return;
    let more = false;
    try {
      more = (await flush()) >= 100;
    } catch (err) {
      log(`event relay: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!stopped) timer = setTimeout(() => { running = loop(); }, more ? 0 : interval);
  };

  return {
    flush,
    // Publishes on a timer until stop(). flush() can also be called by hand at any time.
    start() {
      if (!stopped) return;
      stopped = false;
      running = loop();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}

export function startRelay(opts: Parameters<typeof createRelay>[0]): Relay {
  const relay = createRelay(opts);
  relay.start();
  return relay;
}

// Housekeeping: published rows are kept a week for debugging, then removed.
export async function pruneOutbox(db: Queryable): Promise<number> {
  const r = await db.query(`DELETE FROM events_outbox WHERE published_at < now() - interval '7 days'`);
  return r.rowCount;
}
