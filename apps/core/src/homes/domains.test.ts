import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHomesApp } from './server';
import { cleanDomain } from './domains';
import { client, createTestDb, dbAvailable, dnsRecords, first, loginAs, makeApp, makeUser, SITE_YAML } from '../test/harness';
import { parseSiteConfig } from '../config';

const cfg = parseSiteConfig(SITE_YAML());
describe('cleanDomain', () => {
  it('accepts ordinary domains and tidies them', () => {
    expect(cleanDomain(' MySite.COM. ', { config: cfg })).toBe('mysite.com');
    expect(cleanDomain('www.my-site.co.uk', { config: cfg })).toBe('www.my-site.co.uk');
  });
  it('refuses what cannot be a domain, addresses and names that belong to the site', () => {
    for (const d of ['', 'com', 'localhost', '1.2.3.4', 'a b.com', 'http://x.com', 'x.com/path', '-x.com', 'x..com', 'example.test', 'www.example.test', 'alice.example-homes.test', 'example-homes.test', `${'a'.repeat(64)}.com`]) {
      expect(() => cleanDomain(d, { config: cfg }), d).toThrow();
    }
  });
});

describe.skipIf(!dbAvailable)('custom domains', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let server: Awaited<ReturnType<typeof buildHomesApp>>;
  type P = { id: string; handle: string; c: ReturnType<typeof client> };
  let alice: P, bob: P;
  const person = async (handle: string): Promise<P> => { const u = await makeUser(ctx, { handle }); return { id: u.id, handle, c: await loginAs(ctx, handle) }; };
  const put = (p: P, path: string, body: string) => ctx.app.inject({ method: 'PUT', url: `/api/v1/homes/me/file?path=${path}`, payload: body, headers: { origin: 'https://example.test', cookie: `sid=${p.c.sid}`, 'content-type': 'text/plain' } });
  const add = (p: P, domain: string) => p.c.post('/api/v1/homes/me/domains', { domain });
  const verify = (p: P, domain: string) => p.c.post(`/api/v1/homes/me/domains/${domain}/verify`);
  const serve = (host: string, url = '/') => server.inject({ method: 'GET', url, headers: { host } });
  const ask = (domain: string, secret?: string) => ctx.app.inject({ method: 'GET', url: `/internal/tls-ask?domain=${encodeURIComponent(domain)}${secret ? `&secret=${secret}` : ''}` });

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    ctx = await makeApp(db, { yaml: SITE_YAML('homes: { public_ip: 203.0.113.7, max_domains: 2 }') });
    server = await buildHomesApp(ctx.deps);
    alice = await person('alice');
    bob = await person('bob');
    await put(alice, 'index.html', '<h1>alice on her own domain</h1>');
    await put(bob, 'index.html', '<h1>bob</h1>');
  });
  afterAll(async () => { await server.close(); await drop(); });

  it('tells a person what to add to their DNS', async () => {
    const r = await add(alice, 'alice-site.com');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ domain: 'alice-site.com', status: 'pending' });
    expect(r.body.dns.txt.name).toBe('_home-verify.alice-site.com');
    expect(r.body.dns.txt.value).toMatch(/^home-verify=[0-9a-f]{32}$/);
    expect(r.body.dns.point_to).toMatchObject({ type: 'A', value: '203.0.113.7' }); // a bare domain needs an A record
    const www = (await add(alice, 'www.alice-site.com')).body;
    expect(www.dns.point_to).toEqual({ type: 'CNAME', value: 'alice.example-homes.test', note: '' });
  });

  it('does not serve or certify a domain until it is verified', async () => {
    expect((await serve('alice-site.com')).statusCode).toBe(404);
    expect((await ask('alice-site.com')).statusCode).toBe(404);
  });

  it('says what it found when the record is missing or wrong, and does not verify', async () => {
    let r = await verify(alice, 'alice-site.com');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('not_verified');
    expect(r.body.error.message).toContain('No TXT record found at _home-verify.alice-site.com');
    dnsRecords.set('_home-verify.alice-site.com', ['home-verify=wrong', 'v=spf1 -all']);
    r = await verify(alice, 'alice-site.com');
    expect(r.body.error.message).toContain('Found 2 TXT records');
    const listed = (await alice.c.get('/api/v1/homes/me/domains')).body;
    expect(listed.domains[0]).toMatchObject({ status: 'pending', last_error: expect.stringContaining('none matches') });
    expect(listed.max).toBe(2);
  });

  it('verifies with the right record, then serves the person’s homepage on that name and allows a certificate', async () => {
    const token = (await alice.c.get('/api/v1/homes/me/domains')).body.domains[0].dns.txt.value;
    dnsRecords.set('_home-verify.alice-site.com', ['unrelated', token]);
    const r = await verify(alice, 'alice-site.com');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'verified', last_error: null });
    const page = await serve('alice-site.com');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('alice on her own domain');
    expect(page.body).toContain('site-report-footer');
    expect(page.headers['set-cookie']).toBeUndefined();
    expect((await serve('ALICE-SITE.com:8443')).statusCode).toBe(200);
    expect((await serve('www.alice-site.com')).statusCode).toBe(404); // each name is verified on its own
    expect((await ask('alice-site.com')).statusCode).toBe(200);
    expect((await verify(alice, 'alice-site.com')).status).toBe(200); // again is fine
    expect(first(await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'custom_domain.verified'`)).n).toBe(1);
  });

  it('gives a name to the person who proves it, not the one who asked first', async () => {
    expect((await add(bob, 'contested.com')).status).toBe(201); // bob asks first, and never proves it
    await alice.c.delete('/api/v1/homes/me/domains/www.alice-site.com'); // makes room: alice is at her limit of 2
    expect((await add(alice, 'contested.com')).status).toBe(201);
    expect((await add(alice, 'contested.com')).body.error.code).toBe('exists');
    const aliceToken = (await alice.c.get('/api/v1/homes/me/domains')).body.domains.find((d: { domain: string }) => d.domain === 'contested.com').dns.txt.value;
    dnsRecords.set('_home-verify.contested.com', [aliceToken]); // only alice's token is in DNS
    expect((await verify(bob, 'contested.com')).status).toBe(409);
    expect((await verify(alice, 'contested.com')).status).toBe(200);
    expect((await serve('contested.com')).body).toContain('alice on her own domain');
    expect((await bob.c.get('/api/v1/homes/me/domains')).body.domains).toHaveLength(0); // bob's request is gone
    expect((await add(bob, 'contested.com')).body.error.code).toBe('domain_taken');
  });

  it('limits how many domains one person can add', async () => {
    expect((await add(alice, 'a-third.com')).body.error.code).toBe('too_many_domains');
  });

  it('stops serving when the person removes it, is suspended, or the page is hidden', async () => {
    await alice.c.delete('/api/v1/homes/me/domains/contested.com');
    expect((await serve('contested.com')).statusCode).toBe(404);
    expect((await ask('contested.com')).statusCode).toBe(404);
    expect((await alice.c.delete('/api/v1/homes/me/domains/contested.com')).status).toBe(404);
    await db.query(`UPDATE homepages SET hidden_at = now() WHERE user_id = $1`, [alice.id]);
    expect((await serve('alice-site.com')).statusCode).toBe(410);
    await db.query(`UPDATE homepages SET hidden_at = NULL WHERE user_id = $1`, [alice.id]);
    await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [alice.id]);
    expect((await serve('alice-site.com')).statusCode).toBe(404);
    expect((await ask('alice-site.com')).statusCode).toBe(404);
    await db.query(`UPDATE users SET status = 'active' WHERE id = $1`, [alice.id]);
  });

  it('only certifies homepage names of real people, verified domains and the bare homes domain', async () => {
    expect((await ask('alice.example-homes.test')).statusCode).toBe(200);
    expect((await ask('nobody.example-homes.test')).statusCode).toBe(404);
    expect((await ask('a.b.example-homes.test')).statusCode).toBe(404);
    expect((await ask('random.example.org')).statusCode).toBe(404);
    // The bare homes domain carries the stable /u/{id}/ links and the apps people add (docs/07, docs/10).
    expect((await ask('example-homes.test')).statusCode).toBe(200);
  });

  it('keeps Caddy’s question private when a secret is set', async () => {
    ctx.deps.tlsAskSecret = 's3cret';
    try {
      expect((await ask('alice.example-homes.test')).statusCode).toBe(403);
      expect((await ask('alice.example-homes.test', 'wrong')).statusCode).toBe(403);
      expect((await ask('alice.example-homes.test', 's3cret')).statusCode).toBe(200);
    } finally { ctx.deps.tlsAskSecret = undefined; }
  });

  it('needs a login, a confirmed email and refuses the site’s own names', async () => {
    expect((await client(ctx.app).get('/api/v1/homes/me/domains')).status).toBe(401);
    const g = await makeUser(ctx, { role: 'guest', verified: false });
    expect((await (await loginAs(ctx, g.handle)).post('/api/v1/homes/me/domains', { domain: 'x.com' })).status).toBe(403);
    expect((await add(alice, 'bob.example-homes.test')).body.error.code).toBe('own_domain');
    expect((await add(alice, 'not a domain')).body.error.code).toBe('bad_domain');
  });
});
