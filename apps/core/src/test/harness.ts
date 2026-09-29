import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { parseSiteConfig } from '../config';
import { connect, type Db } from '../db';
import { buildApp } from '../app';
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

export async function makeApp(db: Db, opts: { yaml?: string; rateLimit?: boolean } = {}) {
  const mailer = memoryMailer();
  const deps: AppDeps = {
    config: parseSiteConfig(opts.yaml ?? SITE_YAML()),
    db, mailer,
    secretKey: randomBytes(32),
    publicUrl: ORIGIN,
    allowedOrigins: [ORIGIN],
    secureCookies: false, // inject() is plain http; cookie flags are covered by a dedicated test
    trustProxy: false,
    rateLimit: opts.rateLimit ?? false,
  };
  const app = await buildApp(deps);
  return { app, deps, mailer };
}

type App = Awaited<ReturnType<typeof makeApp>>['app'];

// A tiny cookie-aware client over fastify.inject().
export function client(app: App) {
  let sid: string | undefined;
  async function call(method: 'GET' | 'POST', url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method, url, payload: body as object | undefined,
      headers: { origin: ORIGIN, ...(sid ? { cookie: `sid=${sid}` } : {}), ...headers },
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
