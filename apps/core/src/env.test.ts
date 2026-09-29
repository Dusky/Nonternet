import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { depsFromEnv } from './env';

const site = fileURLToPath(new URL('../../../deploy/site.example.yaml', import.meta.url));
const base = { SITE_CONFIG: site, DATABASE_URL: 'postgres://u@localhost/x', APP_SECRET_KEY: Buffer.alloc(32, 1).toString('base64') };
const opened: { db: { end(): Promise<void> } }[] = [];
const load = (extra: Record<string, string>) => { const d = depsFromEnv({ ...base, ...extra }, () => undefined); opened.push(d); return d; };
afterEach(async () => { while (opened.length) await opened.pop()!.db.end(); });

describe('rate limit setting', () => {
  it('is on by default', () => expect(load({}).rateLimit).toBe(true));
  it('can be turned off for automated tests', () => expect(load({ RATE_LIMIT: 'off' }).rateLimit).toBe(false));
  it('ignores other values', () => expect(load({ RATE_LIMIT: 'false' }).rateLimit).toBe(true));
  it('refuses to be turned off in production', () => {
    expect(() => depsFromEnv({ ...base, NODE_ENV: 'production', RATE_LIMIT: 'off' }, () => undefined)).toThrow(/not allowed when NODE_ENV=production/);
  });
});
