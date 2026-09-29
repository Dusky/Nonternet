import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { parseSiteConfig } from '../config';
import { connect, type Db } from '../db';
import { buildApp } from '../app';
import { createAdmin } from '../accounts';
import { newId } from '../crypto';
import { hashPassword } from '../passwords';
import { currentTotp } from '../totp';
import type { AppDeps } from '../deps';
import { memoryMailer } from '../mailer';
import { migrate } from '../migrate';

// Integration tests run against a real Postgres. Point TEST_DATABASE_URL at any database on a
// server you can create databases on, e.g. postgres://postgres@localhost:5433/postgres.
// Each test file gets its own throwaway database. CI sets REQUIRE_DB so a missing database
// fails the run instead of skipping.
export const TEST_DB_URL = process.env.TEST_DATABASE_URL;
export const dbAvailable = Boolean(TEST_DB_URL);
if (!dbAvailable && process.env.REQUIRE_DB) throw new Error('REQUIRE_DB is set but TEST_DATABASE_URL is not');
if (!dbAvailable) console.warn('TEST_DATABASE_URL is not set: skipping the database tests');

export const SITE_YAML = (extra = '') => `
site: { name: Test Site, short_name: testsite, domain: example.test, homes_domain: example-homes.test }
${extra}
`;

export async function createTestDb(): Promise<{ db: Db; drop: () => Promise<void> }> {
  const name = `t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: TEST_DB_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(TEST_DB_URL!);
  url.pathname = `/${name}`;
  const db = connect(url.toString());
  await migrate(db);
  return {
    db,
    drop: async () => {
      await db.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export const ORIGIN = 'https://example.test';

// One secret key per test file, as in a real deployment: keys stored by one app must be readable by the next.
const TEST_SECRET_KEY = randomBytes(32);

// The clock the server uses for TOTP. Tests move it forward 30 s at a time to get a fresh code.
export function makeClock(start = Date.now()) {
  const clock = { ms: start, advance(seconds = 30) { clock.ms += seconds * 1000; } };
  return clock;
}

export async function makeApp(db: Db, opts: { yaml?: string; rateLimit?: boolean; oidcClients?: AppDeps['oidcClients']; publicUrl?: string } = {}) {
  const mailer = memoryMailer();
  const clock = makeClock();
  const deps: AppDeps = {
    config: parseSiteConfig(opts.yaml ?? SITE_YAML()),
    db, mailer,
    secretKey: TEST_SECRET_KEY,
    publicUrl: opts.publicUrl ?? ORIGIN,
    allowedOrigins: [opts.publicUrl ?? ORIGIN],
    secureCookies: false, // inject() is plain http; cookie flags are covered by a dedicated test
    trustProxy: false,
    rateLimit: opts.rateLimit ?? false,
    now: () => clock.ms,
    oidcClients: opts.oidcClients ?? [],
  };
  const app = await buildApp(deps);
  return { app, deps, mailer, clock };
}

type App = Awaited<ReturnType<typeof makeApp>>['app'];

// A tiny cookie-aware client over fastify.inject().
export function client(app: App, origin: string = ORIGIN) {
  let sid: string | undefined;
  async function call(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method, url, payload: body as object | undefined,
      headers: { origin, ...(sid ? { cookie: `sid=${sid}` } : {}), ...headers },
    });
    const set = res.cookies.find((c) => c.name === 'sid');
    if (set) sid = set.value || undefined;
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : undefined, res };
  }
  return {
    get: (url: string, headers?: Record<string, string>) => call('GET', url, undefined, headers),
    post: (url: string, body?: unknown, headers?: Record<string, string>) => call('POST', url, body, headers),
    get sid() { return sid; },
    set sid(v: string | undefined) { sid = v; },
  };
}
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

export function tokenFromMail(text: string): string {
  const m = /token=([^\s&]+)/.exec(text);
  if (!m) throw new Error(`no token in mail: ${text}`);
  return decodeURIComponent(m[1]!);
}

// The single row a query must return; fails with a clear message instead of a TypeError later.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function first<T = any>(result: { rows: T[] }): T {
  const row = result.rows[0];
  if (!row) throw new Error('expected the query to return a row');
  return row;
}

// Waits for mail that the server sends in the background (password reset).
export async function waitForMail(mailer: { sent: unknown[] }, count: number, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (mailer.sent.length < count) {
    if (Date.now() > end) throw new Error(`expected ${count} emails, saw ${mailer.sent.length}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---------------------------------------------------------------- Redis (event bus tests)

// Point TEST_REDIS_URL at a Redis you don't mind tests writing to, e.g. redis://localhost:6380.
// Each test uses its own stream prefix. CI sets REQUIRE_REDIS.
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
export const redisAvailable = Boolean(TEST_REDIS_URL);
if (!redisAvailable && process.env.REQUIRE_REDIS) throw new Error('REQUIRE_REDIS is set but TEST_REDIS_URL is not');
if (!redisAvailable) console.warn('TEST_REDIS_URL is not set: skipping the event bus tests');

// ---------------------------------------------------------------- people

export const TEST_PASSWORD = 'correct horse battery';
type Ctx = Awaited<ReturnType<typeof makeApp>>;
let personCounter = 0;

// A user straight in the database (no signup flow), with a known password.
export async function makeUser(ctx: Pick<Ctx, 'deps'>, opts: { role?: 'guest' | 'user' | 'trusted' | 'admin'; verified?: boolean; handle?: string } = {}) {
  const n = ++personCounter;
  const handle = opts.handle ?? `person${n}`;
  const email = `${handle.toLowerCase()}@example.test`;
  const id = newId('u');
  await ctx.deps.db.query(
    `INSERT INTO users (id, handle, email, email_verified_at, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, handle, email, opts.verified === false ? null : new Date(), await hashPassword(TEST_PASSWORD), opts.role ?? 'user']);
  return { id, handle, email };
}

export async function loginAs(ctx: Pick<Ctx, 'app' | 'deps'>, handle: string) {
  const c = client(ctx.app, ctx.deps.publicUrl);
  const r = await c.post('/api/v1/auth/login', { identifier: handle, password: TEST_PASSWORD });
  if (r.status !== 200) throw new Error(`login as ${handle} failed: ${JSON.stringify(r.body)}`);
  return c;
}

// An admin with two-factor fully set up, logged in. Moves the test clock forward as it needs to.
export async function makeAdmin(ctx: Ctx, handle?: string) {
  const name = handle ?? `admin${++personCounter}`;
  const id = await createAdmin(ctx.deps, { handle: name, email: `${name}@example.test`, password: TEST_PASSWORD });
  const c = await loginAs(ctx, name);
  const setup = (await c.post('/api/v1/me/totp/setup')).body;
  ctx.clock.advance();
  const enabled = await c.post('/api/v1/me/totp/enable', { code: await currentTotp(setup.secret, ctx.clock.ms) });
  if (enabled.status !== 200) throw new Error(`totp enable failed: ${JSON.stringify(enabled.body)}`);
  return { id, handle: name, client: c, secret: setup.secret as string };
}
