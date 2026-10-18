import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashIp, ipKey } from './crypto';
import { randomBytes } from 'node:crypto';
import { client, createTestDb, dbAvailable, makeApp, makeUser, TEST_PASSWORD } from './test/harness';

const KEY = randomBytes(32);

// Login limits that a changing address can't escape (docs/15, research pick 2026-10-18).
describe('ipKey and hashIp', () => {
  it('keeps IPv4 whole and groups IPv6 by its /64', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe(ipKey('2001:db8:1:2:bbbb::9'));
    expect(ipKey('2001:db8:1:2::1')).not.toBe(ipKey('2001:db8:1:3::1'));
    expect(hashIp(KEY, '2001:db8:1:2::1')).toBe(hashIp(KEY, '2001:db8:1:2:ffff:ffff:ffff:ffff'));
  });
});

describe.skipIf(!dbAvailable)('per-account login limit', () => {
  let drop: () => Promise<void>;
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { const t = await createTestDb(); drop = t.drop; ctx = await makeApp(t.db); });
  afterAll(async () => drop());

  it('after ten wrong passwords from anywhere, the account refuses password logins for a while', async () => {
    const u = await makeUser(ctx);
    // Each try from a different address, as a guesser rotating addresses would.
    for (let i = 0; i < 10; i++) {
      const r = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `198.51.100.${i + 1}`, headers: { origin: 'https://example.test' }, payload: { identifier: u.handle, password: 'wrong password here' } });
      expect(r.statusCode).toBe(401);
    }
    const right = await client(ctx.app).post('/api/v1/auth/login', { identifier: u.handle, password: TEST_PASSWORD });
    expect(right.status).toBe(429);
    expect(right.body.error.code).toBe('too_many_attempts');
    ctx.clock.advance(16 * 60);
    expect((await client(ctx.app).post('/api/v1/auth/login', { identifier: u.handle, password: TEST_PASSWORD })).status).toBe(200);
  });
});
