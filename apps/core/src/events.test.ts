import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventEnvelopeSchema, type DomainEvent } from '@app/shared';
import { newId } from './crypto';
import { createRelay, emit, pruneOutbox, redisBus, startRelay, type EventBus } from './events';
import { createTestDb, dbAvailable, redisAvailable, TEST_REDIS_URL } from './test/harness';

const ready = dbAvailable && redisAvailable;

describe.skipIf(!ready)('event outbox, relay and bus', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  const buses: EventBus[] = [];
  let probe: Redis;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    probe = new Redis(TEST_REDIS_URL!);
  });
  afterAll(async () => {
    await Promise.all(buses.map((b) => b.close()));
    await probe.quit();
    await drop();
  });

  // A bus on its own stream, so tests never see each other's events.
  const newBus = () => {
    const prefix = `t${randomBytes(4).toString('hex')}:`;
    const bus = redisBus(TEST_REDIS_URL!, { streamPrefix: prefix });
    buses.push(bus);
    return { bus, prefix };
  };
  const uid = () => newId('u');
  const created = (userId = uid()) => ({ user_id: userId, handle: 'someone', role: 'user' as const });
  const clearOutbox = () => db.query(`DELETE FROM events_outbox`);
  const collect = (bus: EventBus, group: string, extra: Partial<Parameters<EventBus['subscribe']>[0]> = {}) => {
    const got: DomainEvent[] = [];
    const ac = new AbortController();
    const done = bus.subscribe({ group, consumer: `${group}-1`, from: 'start', blockMs: 100, signal: ac.signal, handler: async (e) => { got.push(e); }, ...extra });
    return { got, stop: async () => { ac.abort(); await done; } };
  };
  const until = async (cond: () => boolean | Promise<boolean>, ms = 4000) => {
    const end = Date.now() + ms;
    while (!(await cond())) {
      if (Date.now() > end) throw new Error('timed out waiting');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  describe('outbox', () => {
    it('records an event with the change, and leaves nothing when the change rolls back', async () => {
      await clearOutbox();
      await db.tx(async (q) => { await emit(q, 'user.created', created()); });
      await expect(db.tx(async (q) => { await emit(q, 'user.created', created()); throw new Error('the change failed'); })).rejects.toThrow('the change failed');
      const rows = (await db.query(`SELECT event_id, type, published_at FROM events_outbox`)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.type).toBe('user.created');
      expect(rows[0]!.event_id).toMatch(/^e_[0-9A-Z]{26}$/);
      expect(rows[0]!.published_at).toBeNull();
    });

    it('refuses a malformed event, and the change with it', async () => {
      await clearOutbox();
      await expect(db.tx(async (q) => { await emit(q, 'user.suspended', { user_id: 'not-an-id' }); })).rejects.toThrow();
      expect((await db.query(`SELECT 1 FROM events_outbox`)).rowCount).toBe(0);
    });

    it('prunes old published rows and nothing else', async () => {
      await clearOutbox();
      await db.query(`INSERT INTO events_outbox (event_id, type, payload, created_at, published_at) VALUES
        ('e_OLDPUBLISHED', 'user.suspended', '{}', now() - interval '9 days', now() - interval '8 days'),
        ('e_RECENTPUBLISHED', 'user.suspended', '{}', now() - interval '2 days', now() - interval '1 day'),
        ('e_OLDUNPUBLISHED', 'user.suspended', '{}', now() - interval '9 days', NULL)`);
      expect(await pruneOutbox(db)).toBe(1);
      const left = (await db.query(`SELECT event_id FROM events_outbox ORDER BY id`)).rows.map((r) => r.event_id);
      expect(left).toEqual(['e_RECENTPUBLISHED', 'e_OLDUNPUBLISHED']);
    });
  });

  describe('relay', () => {
    it('publishes unpublished events in order, once, and marks them', async () => {
      await clearOutbox();
      const { bus, prefix } = newBus();
      const ids = [uid(), uid(), uid()];
      for (const id of ids) await db.tx((q) => emit(q, 'user.created', created(id)));
      const relay = createRelay({ db, bus });
      expect(await relay.flush()).toBe(3);
      expect(await relay.flush()).toBe(0);
      const entries = await probe.xrange(`${prefix}events`, '-', '+');
      const events = entries.map(([, f]) => eventEnvelopeSchema.parse(JSON.parse(f[1]!)));
      expect(events.map((e) => e.payload.user_id)).toEqual(ids);
      expect(events.every((e) => e.type === 'user.created' && !Number.isNaN(Date.parse(e.at)))).toBe(true);
      expect((await db.query(`SELECT 1 FROM events_outbox WHERE published_at IS NULL`)).rowCount).toBe(0);
    });

    it('never loses an event when publishing fails part-way: the rest go out on the next pass', async () => {
      await clearOutbox();
      const { bus, prefix } = newBus();
      const ids = [uid(), uid(), uid(), uid()];
      for (const id of ids) await db.tx((q) => emit(q, 'user.created', created(id)));
      let calls = 0;
      const flaky: EventBus = { ...bus, publish: async (e) => { if (++calls === 3) throw new Error('redis went away'); return bus.publish(e); } };
      const relay = createRelay({ db, bus: flaky });
      await expect(relay.flush()).rejects.toThrow('redis went away');
      expect((await db.query(`SELECT 1 FROM events_outbox WHERE published_at IS NOT NULL`)).rowCount).toBe(2);
      expect(await relay.flush()).toBe(2);
      const published = (await probe.xrange(`${prefix}events`, '-', '+')).map(([, f]) => JSON.parse(f[1]!).payload.user_id);
      expect(published).toEqual(ids); // all four, in order, none twice
    });

    it('lets two relays run at once without publishing anything twice', async () => {
      await clearOutbox();
      const { bus, prefix } = newBus();
      const ids = Array.from({ length: 30 }, uid);
      for (const id of ids) await db.tx((q) => emit(q, 'user.created', created(id)));
      const a = createRelay({ db, bus });
      const b = createRelay({ db, bus });
      await Promise.all([a.flush(), b.flush(), a.flush(), b.flush()]);
      const published = (await probe.xrange(`${prefix}events`, '-', '+')).map(([, f]) => JSON.parse(f[1]!).payload.user_id);
      expect(published.sort()).toEqual([...ids].sort());
    });

    it('publishes on its own, without being asked', async () => {
      await clearOutbox();
      const { bus, prefix } = newBus();
      const relay = startRelay({ db, bus, intervalMs: 30 });
      await db.tx((q) => emit(q, 'user.created', created()));
      await until(async () => (await probe.xlen(`${prefix}events`)) === 1);
      await relay.stop();
    });

    it('keeps going after a failure and reports it', async () => {
      await clearOutbox();
      const { bus } = newBus();
      const logs: string[] = [];
      let fail = true;
      const flaky: EventBus = { ...bus, publish: async (e) => { if (fail) throw new Error('down'); return bus.publish(e); } };
      const relay = startRelay({ db, bus: flaky, intervalMs: 30, log: (m) => logs.push(m) });
      await db.tx((q) => emit(q, 'user.created', created()));
      await until(() => logs.length > 0);
      expect(logs[0]).toContain('down');
      fail = false;
      await until(async () => (await db.query(`SELECT 1 FROM events_outbox WHERE published_at IS NOT NULL`)).rowCount === 1);
      await relay.stop();
    });
  });

  describe('subscribing', () => {
    const publish = (bus: EventBus, userId: string) =>
      bus.publish({ id: newId('e'), type: 'user.created', at: new Date().toISOString(), payload: created(userId) });

    it('gives every group every event, and each event once within a group', async () => {
      const { bus } = newBus();
      const g1a = collect(bus, 'g1', { consumer: 'a' });
      const g1b = collect(bus, 'g1', { consumer: 'b' });
      const g2 = collect(bus, 'g2');
      await new Promise((r) => setTimeout(r, 100));
      const ids = Array.from({ length: 10 }, uid);
      for (const id of ids) await publish(bus, id);
      await until(() => g2.got.length === 10 && g1a.got.length + g1b.got.length === 10);
      expect(g2.got.map((e) => e.payload.user_id)).toEqual(ids);
      const shared = [...g1a.got, ...g1b.got].map((e) => e.payload.user_id).sort();
      expect(shared).toEqual([...ids].sort());
      await Promise.all([g1a.stop(), g1b.stop(), g2.stop()]);
    });

    it('starts a new group from new events by default, and from the beginning on request', async () => {
      const { bus } = newBus();
      const early = uid();
      await publish(bus, early);
      const fresh = collect(bus, 'fresh', { from: 'new' });
      const all = collect(bus, 'all', { from: 'start' });
      await new Promise((r) => setTimeout(r, 150));
      const later = uid();
      await publish(bus, later);
      await until(() => all.got.length === 2 && fresh.got.length === 1);
      expect(fresh.got.map((e) => e.payload.user_id)).toEqual([later]);
      expect(all.got.map((e) => e.payload.user_id)).toEqual([early, later]);
      await Promise.all([fresh.stop(), all.stop()]);
    });

    it('retries an event whose handler failed, then acknowledges it', async () => {
      const { bus } = newBus();
      let attempts = 0;
      const errors: unknown[] = [];
      const c = collect(bus, 'retry', {
        reclaimIdleMs: 50,
        onError: (e) => errors.push(e),
        handler: async () => { if (++attempts < 3) throw new Error('not yet'); },
      });
      await publish(bus, uid());
      await until(() => attempts === 3);
      await new Promise((r) => setTimeout(r, 300));
      expect(attempts).toBe(3); // acknowledged on the third, not delivered again
      expect(errors).toHaveLength(2);
      await c.stop();
    });

    it('moves an event that keeps failing to the dead stream instead of retrying forever', async () => {
      const { bus, prefix } = newBus();
      let attempts = 0;
      const c = collect(bus, 'poison', { reclaimIdleMs: 30, maxDeliveries: 3, handler: async () => { attempts++; throw new Error('always'); } });
      const poisoned = uid();
      await publish(bus, poisoned);
      await until(async () => (await probe.xlen(`${prefix}events:dead`)) === 1);
      expect(attempts).toBe(3);
      const [, fields] = (await probe.xrange(`${prefix}events:dead`, '-', '+'))[0]!;
      expect(fields).toContain('poison');
      expect(fields.join(' ')).toContain(poisoned);
      await new Promise((r) => setTimeout(r, 200));
      expect(attempts).toBe(3);
      await c.stop();
    });

    it('picks up where it left off after a restart, without losing unacknowledged events', async () => {
      const { bus } = newBus();
      let seen = 0;
      const first = collect(bus, 'restart', { consumer: 'one', handler: async () => { seen++; throw new Error('crash before ack'); }, reclaimIdleMs: 10_000 });
      await new Promise((r) => setTimeout(r, 100));
      await publish(bus, uid());
      await until(() => seen === 1);
      await first.stop();
      const second = collect(bus, 'restart', { consumer: 'one' }); // same consumer name, so its own pending list is replayed
      await until(() => second.got.length === 1);
      await second.stop();
    });
  });
});
