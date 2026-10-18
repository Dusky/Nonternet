import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { solveChallenge, type Challenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/sha';
import { networkOf } from './signup-guard';
import { client, createTestDb, dbAvailable, makeAdmin, makeApp, TEST_PASSWORD } from './test/harness';

describe('networkOf', () => {
  it('takes the /24 of IPv4 (also when written as IPv6) and the /48 of IPv6', () => {
    expect(networkOf('203.0.113.77')).toBe('203.0.113.0/24');
    expect(networkOf('::ffff:203.0.113.77')).toBe('203.0.113.0/24');
    expect(networkOf('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(networkOf('2001:0DB8:00ab:ffff:1:2:3:4')).toBe('2001:db8:ab::/48');
    expect(networkOf('not an address')).toBeNull();
  });
});

const YAML = (signup: string) => `site: { name: Test Site, short_name: testsite, domain: example.test, homes_domain: example-homes.test }\nsignup: { mode: open, minimum_age: 0, ${signup} }`;

describe.skipIf(!dbAvailable)('sign-up protections', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let n = 0;
  beforeAll(async () => { ({ db, drop } = await createTestDb()); });
  afterAll(async () => drop());

  const person = (over: Record<string, unknown> = {}) => ({ handle: `guard${++n}`, email: `guard${n}@example.test`, password: TEST_PASSWORD, ...over });
  const solve = async (ctx: Awaited<ReturnType<typeof makeApp>>) => {
    const { challenge } = (await client(ctx.app).get('/api/v1/auth/signup-challenge')).body as { challenge: Challenge };
    const solution = await solveChallenge({ challenge, deriveKey });
    return Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
  };

  it('asks for a solved check on open sign-up, accepts it once, and refuses a missing or forged one', async () => {
    const ctx = await makeApp(db, { yaml: YAML('per_network_per_day: 0') });
    const c = client(ctx.app);
    expect((await c.post('/api/v1/auth/signup', person())).body.error.code).toBe('proof_failed');
    const proof = await solve(ctx);
    expect((await c.post('/api/v1/auth/signup', person({ proof }))).status).toBe(201);
    expect((await c.post('/api/v1/auth/signup', person({ proof }))).body.error.code).toBe('proof_failed'); // used once already
    const forged = JSON.parse(Buffer.from(await solve(ctx), 'base64').toString());
    forged.challenge.parameters.keyPrefix = '0';
    expect((await c.post('/api/v1/auth/signup', person({ proof: Buffer.from(JSON.stringify(forged)).toString('base64') }))).body.error.code).toBe('proof_failed');
    expect((await c.post('/api/v1/auth/signup', person({ proof: 'bm90IGpzb24=' }))).body.error.code).toBe('proof_failed');
  });

  it('skips the check when switched off, and for invite sign-up', async () => {
    const off = await makeApp(db, { yaml: YAML('proof_of_work: false, per_network_per_day: 0') });
    expect((await client(off.app).get('/api/v1/auth/signup-challenge')).body.challenge).toBeNull();
    expect((await client(off.app).post('/api/v1/auth/signup', person())).status).toBe(201);
    const inv = await makeApp(db, { yaml: `site: { name: Test Site, short_name: testsite, domain: example.test, homes_domain: example-homes.test }\nsignup: { mode: invite }` });
    expect((await client(inv.app).get('/api/v1/auth/signup-challenge')).body.challenge).toBeNull();
  });

  it('limits sign-ups a day from one network, keeping only a hash of it', async () => {
    await db.query(`UPDATE users SET signup_net = NULL`); // earlier tests here signed up from the same address
    const ctx = await makeApp(db, { yaml: YAML('proof_of_work: false, per_network_per_day: 2') });
    const c = client(ctx.app);
    expect((await c.post('/api/v1/auth/signup', person())).status).toBe(201);
    expect((await c.post('/api/v1/auth/signup', person())).status).toBe(201);
    const third = await c.post('/api/v1/auth/signup', person());
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('network_limit');
    const nets = (await db.query<{ signup_net: string }>(`SELECT DISTINCT signup_net FROM users WHERE signup_net IS NOT NULL`)).rows;
    expect(nets.every((r) => /^[0-9a-f]{64}$/.test(r.signup_net))).toBe(true);

    const boss = await makeAdmin(ctx, 'netboss');
    const view = (await boss.client.get('/api/v1/admin/signups')).body;
    expect(view.networks[0].people.length).toBeGreaterThanOrEqual(2);
    expect(view.networks[0].network).toHaveLength(8);
  });

  it('refuses throwaway addresses and denied domains, and lets allowed ones in', async () => {
    const ctx = await makeApp(db, { yaml: YAML('proof_of_work: false, per_network_per_day: 0, email_deny: "spam.example, junk.example", email_allow: "yopmail.com"') });
    const c = client(ctx.app);
    expect((await c.post('/api/v1/auth/signup', person({ email: `x${n}@mailinator.com` }))).body.error.code).toBe('email_disposable');
    expect((await c.post('/api/v1/auth/signup', person({ email: `x${n}@sub.mailinator.com` }))).body.error.code).toBe('email_disposable');
    expect((await c.post('/api/v1/auth/signup', person({ email: `x${n}@mail.junk.example` }))).body.error.code).toBe('email_domain_refused');
    expect((await c.post('/api/v1/auth/signup', person({ email: `x${n}@yopmail.com` }))).status).toBe(201);
    // A newer list from sitectl replaces the bundled one, read again when it changes.
    const dir = mkdtempSync(join(tmpdir(), 'disposable-'));
    writeFileSync(join(dir, 'list.txt'), 'freshly-listed.example\n');
    process.env.DISPOSABLE_DOMAINS_FILE = join(dir, 'list.txt');
    try {
      expect((await c.post('/api/v1/auth/signup', person({ email: `z${n}@freshly-listed.example` }))).body.error.code).toBe('email_disposable');
      expect((await c.post('/api/v1/auth/signup', person({ email: `z${n}@mailinator.com` }))).status).toBe(201);
    } finally { delete process.env.DISPOSABLE_DOMAINS_FILE; }
    const off = await makeApp(db, { yaml: YAML('proof_of_work: false, per_network_per_day: 0, block_disposable_email: false') });
    expect((await client(off.app).post('/api/v1/auth/signup', person({ email: `y${n}@mailinator.com` }))).status).toBe(201);
  });
});
