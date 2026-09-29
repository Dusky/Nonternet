import { describe, expect, it } from 'vitest';
import { parseSiteConfig } from './config';
import { buildApp } from './app';

const config = parseSiteConfig(`
site: { name: Some Other Name, short_name: other, domain: example.test, homes_domain: example-homes.test }
services: { irc: true }
`);

describe('core app', () => {
  it('reports healthy', async () => {
    const res = await buildApp(config).inject('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('serves the public site config, driven by config alone', async () => {
    const res = await buildApp(config).inject('/api/v1/site');
    expect(res.json()).toMatchObject({
      name: 'Some Other Name',
      short_name: 'other',
      signup_mode: 'invite',
      services: { bbs: false, irc: true, mud: false },
    });
  });

  it('does not leak non-public config', async () => {
    const body = (await buildApp(config).inject('/api/v1/site')).json();
    expect(body).not.toHaveProperty('limits');
    expect(body).not.toHaveProperty('signup');
  });
});
