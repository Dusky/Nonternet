import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, dbAvailable, makeApp, SITE_YAML } from './test/harness';

describe.skipIf(!dbAvailable)('site endpoints', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  beforeAll(async () => { ({ db, drop } = await createTestDb()); });
  afterAll(async () => drop());

  it('reports healthy and ready', async () => {
    const { app } = await makeApp(db);
    expect((await app.inject('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await app.inject('/readyz')).json()).toEqual({ status: 'ready' });
  });

  it('serves the public site config, driven by config alone', async () => {
    const { app } = await makeApp(db, { yaml: SITE_YAML('services: { irc: true }') });
    expect((await app.inject('/api/v1/site')).json()).toMatchObject({
      name: 'Test Site', short_name: 'testsite', signup_mode: 'invite', services: { bbs: false, irc: true, mud: false, gopher: false },
    });
  });

  it('does not leak non-public config', async () => {
    const { app } = await makeApp(db);
    const body = (await app.inject('/api/v1/site')).json();
    expect(body).not.toHaveProperty('limits');
    expect(body).not.toHaveProperty('signup');
  });
});
