import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import webpush from 'web-push';
import { runOnce } from 'graphile-worker';
import { processNext } from './exports/service';
import { migrateWorker, quietLogger } from './migrate';
import { newVapidKeys, pushTask } from './push';
import { client, createTestDb, dbAvailable, loginAs, makeApp, makeUser, TEST_PASSWORD } from './test/harness';

// Push notifications (docs/10): a device signs up for the kinds it wants; a reply or a letter queues one job per
// device; the job sends who-and-where only; a device the push service says is gone is forgotten; a push service
// that fails is tried again; logging out stops a device; the person's devices are in the export without their keys.

// What a browser would send: an https push address and its keys (a real P-256 public key and 16 random bytes).
function browserSubscription(n: number) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint: `https://push.example.test/send/${n}-${randomBytes(4).toString('hex')}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

describe.skipIf(!dbAvailable)('push notifications', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  type C = ReturnType<typeof client>;
  const people: Record<string, { id: string; handle: string; c: C }> = {};
  const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag: string } }[] = [];
  let answer: (endpoint: string) => number = () => 201;

  // The push service, played here: records what it was sent, and answers with `answer`.
  const fakeSend = (async (sub: { endpoint: string }, payload: string) => {
    const status = answer(sub.endpoint);
    if (status >= 300) throw Object.assign(new Error(`push service said ${status}`), { statusCode: status });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    return { statusCode: status, body: '', headers: {} };
  }) as unknown as typeof webpush.sendNotification;
  const work = () => runOnce({ pgPool: db.pool, logger: quietLogger, taskList: { push_send: pushTask(ctx.deps, fakeSend) } });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    await migrateWorker(db);
    ctx = await makeApp(db);
    ctx.deps.push = { ...newVapidKeys(), subject: 'mailto:admin@example.test' };
    for (const name of ['owner', 'alice', 'bob']) {
      const u = await makeUser(ctx, { role: name === 'owner' ? 'trusted' : 'user', handle: name });
      people[name] = { id: u.id, handle: u.handle, c: await loginAs(ctx, u.handle) };
    }
    await people.owner!.c.post('/api/v1/boards', { slug: 'lounge', name: 'Lounge', visibility: 'public' });
  });
  afterAll(async () => drop());

  const p = (n: string) => people[n]!;
  const jobs = async () => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM graphile_worker.jobs`)).rows[0]!.n);

  it('gives browsers the public key, and only to signed-in people the device list', async () => {
    expect((await client(ctx.app).get('/api/v1/push')).body).toEqual({ key: ctx.deps.push!.publicKey });
    expect((await client(ctx.app).get('/api/v1/me/push')).status).toBe(401);
    expect((await p('alice').c.post('/api/v1/me/push', { ...browserSubscription(0), endpoint: 'http://push.example.test/x', kinds: ['mail'] })).status).toBe(400);
  });

  it('sends a reply and a letter to the devices that want them, saying who and where but not what', async () => {
    const phone = browserSubscription(1);
    const laptop = browserSubscription(2);
    const a = await p('alice').c.post('/api/v1/me/push', { ...phone, kinds: ['reply', 'mail'], label: 'Phone' });
    expect(a.status).toBe(200);
    await p('alice').c.post('/api/v1/me/push', { ...laptop, kinds: ['mail'], label: 'Laptop' });
    expect((await p('alice').c.get('/api/v1/me/push')).body.devices.map((d: { label: string }) => d.label)).toEqual(['Phone', 'Laptop']);

    const thread = (await p('alice').c.post('/api/v1/boards/lounge/posts', { subject: 'Synths', body: 'Which one?' })).body;
    await p('bob').c.post('/api/v1/boards/lounge/posts', { body: 'The secret answer is the Juno', reply_to: thread.id });
    expect(await jobs()).toBe(1); // the phone wants replies; the laptop doesn't
    await work();
    expect(sent).toEqual([{ endpoint: phone.endpoint, payload: { title: 'Test Site', body: 'bob replied to you in Lounge', url: `/boards/lounge/t/${thread.id}`, tag: expect.stringMatching(/^post:/) } }]);
    expect(JSON.stringify(sent)).not.toContain('Juno');

    sent.length = 0;
    const letter = (await p('bob').c.post('/api/v1/mail', { to: ['alice'], subject: 'Private plans', body: 'Meet at nine' })).body;
    await work();
    expect(sent.map((s) => s.endpoint).sort()).toEqual([phone.endpoint, laptop.endpoint].sort());
    expect(sent[0]!.payload).toEqual({ title: 'Test Site', body: 'bob sent you mail', url: `/mail/${letter.id}`, tag: `mail:${letter.id}` });
    expect(JSON.stringify(sent)).not.toMatch(/Private plans|Meet at nine/);
    expect((await p('alice').c.get('/api/v1/me/push')).body.devices.every((d: { last_used_at: string | null }) => d.last_used_at)).toBe(true);
  });

  it('a real message encrypts with the keys a browser gave', () => {
    const s = browserSubscription(3);
    const req = webpush.generateRequestDetails(s, JSON.stringify({ title: 't', body: 'b', url: '/', tag: 'x' }), { vapidDetails: ctx.deps.push! });
    expect(req.endpoint).toBe(s.endpoint);
    expect(req.headers.Authorization).toMatch(/^vapid t=/);
    expect(req.body!.length).toBeGreaterThan(0);
  });

  it('forgets a device the push service says is gone, and tries a failing one again', async () => {
    const gone = browserSubscription(4);
    const flaky = browserSubscription(5);
    await p('bob').c.post('/api/v1/me/push', { ...gone, kinds: ['mail'] });
    await p('bob').c.post('/api/v1/me/push', { ...flaky, kinds: ['mail'] });
    answer = (e) => (e === gone.endpoint ? 410 : 503);
    await p('alice').c.post('/api/v1/mail', { to: ['bob'], subject: 'Hi', body: 'hello' });
    await work();
    const left = (await db.query<{ endpoint: string; failures: number }>(`SELECT endpoint, failures FROM push_subscriptions WHERE user_id = $1`, [p('bob').id])).rows;
    expect(left).toEqual([{ endpoint: flaky.endpoint, failures: 1 }]);
    const retry = (await db.query<{ attempts: number; max_attempts: number }>(`SELECT attempts, max_attempts FROM graphile_worker.jobs`)).rows;
    expect(retry).toEqual([{ attempts: 1, max_attempts: 5 }]); // waiting to be tried again, with backoff
    answer = () => 201;
    await db.query(`UPDATE graphile_worker._private_jobs SET run_at = now()`);
    await work();
    expect(await jobs()).toBe(0);
  });

  it('logging out stops that device, and the devices are in the export without their keys', async () => {
    const c = await loginAs(ctx, 'alice');
    const shared = browserSubscription(6);
    await c.post('/api/v1/me/push', { ...shared, kinds: ['mail'], label: 'Library computer' });
    await c.post('/api/v1/auth/logout');
    expect((await db.query(`SELECT 1 FROM push_subscriptions WHERE endpoint = $1`, [shared.endpoint])).rowCount).toBe(0);

    expect((await p('alice').c.post('/api/v1/me/export', { password: TEST_PASSWORD })).status).toBe(202);
    await processNext(ctx.deps);
    const x = (await db.query<{ id: string }>(`SELECT id FROM exports WHERE user_id = $1 AND status = 'ready'`, [p('alice').id])).rows[0]!;
    const files = unzipSync(new Uint8Array(readFileSync(join(ctx.deps.exportsDir, `${x.id}.zip`))));
    const devices = JSON.parse(strFromU8(files['settings/push-devices.json']!));
    expect(devices.map((d: { label: string }) => d.label)).toEqual(['Phone', 'Laptop']);
    expect(strFromU8(files['settings/push-devices.json']!)).not.toMatch(/push\.example\.test|p256dh|auth/);
  });

  it('serves a manifest and icons made from the site config', async () => {
    const m = await client(ctx.app).get('/api/v1/site/manifest.webmanifest');
    expect(m.res.headers['content-type']).toContain('application/manifest+json');
    expect(m.body).toMatchObject({ name: 'Test Site', short_name: 'Test Site', start_url: '/', display: 'standalone' });
    const icon = await client(ctx.app).get('/api/v1/site/icon-512.png');
    expect(icon.res.headers['content-type']).toBe('image/png');
    expect(icon.res.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    expect((await client(ctx.app).get('/api/v1/site/icon-9.png')).status).toBe(404);
  });
});
