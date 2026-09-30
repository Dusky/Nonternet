import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from './accounts';
import { isPublicRoute } from './public-routes';
import { client, createTestDb, dbAvailable, makeApp, ORIGIN } from './test/harness';

const PASSWORD = 'correct horse battery';

describe.skipIf(!dbAvailable)('request security', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  beforeAll(async () => { ({ db, drop } = await createTestDb()); });
  afterAll(async () => drop());

  it('refuses state-changing requests from another origin', async () => {
    const { app } = await makeApp(db);
    const r = await client(app).post('/api/v1/auth/login', { identifier: 'a', password: 'b' }, { origin: 'https://evil.test' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('bad_origin');
  });

  it('refuses a cookie-bearing state-changing request that has no Origin', async () => {
    const { app, deps } = await makeApp(db);
    await createAdmin(deps, { handle: 'boss', email: 'boss@example.test', password: PASSWORD });
    const c = client(app);
    await c.post('/api/v1/auth/login', { identifier: 'boss', password: PASSWORD });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: `sid=${c.sid}` } });
    expect(res.statusCode).toBe(403);
  });

  it('lets non-browser clients without a cookie or Origin through', async () => {
    const { app } = await makeApp(db);
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'nobody', password: 'x' } });
    expect(res.statusCode).toBe(401); // reached the login handler, not blocked as CSRF
  });

  it('never blocks reads', async () => {
    const { app } = await makeApp(db);
    expect((await client(app).get('/api/v1/site', { origin: 'https://evil.test' })).status).toBe(200);
  });

  it('marks cookies Secure when the site is served over https', async () => {
    const { app, deps } = await makeApp(db);
    Object.assign(deps, { secureCookies: true });
    await createAdmin(deps, { handle: 'boss2', email: 'boss2@example.test', password: PASSWORD });
    const r = await client(app).post('/api/v1/auth/login', { identifier: 'boss2', password: PASSWORD });
    expect(r.res.cookies.find((c) => c.name === 'sid')!.secure).toBe(true);
  });

  it('rate limits login attempts per address and account, with a plain message', async () => {
    const { app } = await makeApp(db, { rateLimit: true });
    let last;
    for (let i = 0; i < 9; i++) last = await client(app).post('/api/v1/auth/login', { identifier: 'victim', password: 'wrong wrong wrong' });
    expect(last!.status).toBe(429);
    expect(last!.body.error).toEqual({ code: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' });
    // a different account is not affected
    expect((await client(app).post('/api/v1/auth/login', { identifier: 'someone-else', password: 'wrong wrong wrong' })).status).toBe(401);
  });

  it('rate limits signups per address', async () => {
    const { app } = await makeApp(db, { rateLimit: true });
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await client(app).post('/api/v1/auth/signup', { handle: `spam${i}`, email: `spam${i}@example.test`, password: PASSWORD, invite: 'NOPE', age_confirmed: true })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('accepts a JSON content type with no body, and rejects malformed JSON with a 400', async () => {
    const { app } = await makeApp(db);
    const empty = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin: ORIGIN, 'content-type': 'application/json' } });
    expect(empty.statusCode).toBe(204);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: '{nope', headers: { origin: ORIGIN, 'content-type': 'application/json' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad_request');
  });

  it('returns errors in the documented shape and never leaks internals', async () => {
    const { app } = await makeApp(db);
    const r = await client(app).post('/api/v1/auth/login', { identifier: '' });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body)).toEqual(['error']);
    expect(Object.keys(r.body.error).sort()).toEqual(['code', 'message']);
  });
});

// Every route refuses a visitor with no session unless it is meant to be public, and every private
// /internal route refuses anyone without its service token. A new route must either require a session or be
// added to PUBLIC on purpose.
describe.skipIf(!dbAvailable)('the route audit', () => {
  const isPublic = isPublicRoute;
  const fill = (url: string) => url
    .replace(/:id\b/g, 'u_01HZZZZZZZZZZZZZZZZZZZZZZZ').replace(/:mid\b/g, 'mm_01HZZZZZZZZZZZZZZZZZZZZZZZ').replace(/:userId\b/g, 'u_01HZZZZZZZZZZZZZZZZZZZZZZZ')
    .replace(/:slug\b/g, 'nosuchboard').replace(/:handle\b/g, 'nobody').replace(/:[a-zA-Z]+/g, 'x').replace(/\*$/, 'x');

  it('refuses every non-public route without a session, and every /internal route without its token', async () => {
    const { db, drop } = await createTestDb();
    try {
      const ctx = await makeApp(db);
      const routes = (ctx.app as unknown as { routeList: { method: string; url: string }[] }).routeList;
      expect(routes.length).toBeGreaterThan(150);
      const leaks: string[] = [];
      for (const r of routes) {
        if (isPublic(r.method, r.url)) continue;
        const res = await ctx.app.inject({ method: r.method as 'GET', url: fill(r.url), headers: { origin: 'https://example.test', 'content-type': 'application/json' }, payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}' });
        // 401 (log in), 403 (not allowed / off), 404 for a service that isn't set up are all refusals.
        const refused = res.statusCode === 401 || res.statusCode === 403 || (r.url.startsWith('/internal/') && res.statusCode === 404);
        if (!refused) leaks.push(`${r.method} ${r.url} → ${res.statusCode} ${res.body.slice(0, 100)}`);
      }
      expect(leaks).toEqual([]);
    } finally { await drop(); }
  }, 60_000);
});
