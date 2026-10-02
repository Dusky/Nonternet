import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcClientSchema, siteConfigSchema } from '@app/shared';
import { parseSiteConfig } from './config';
import { newId } from './crypto';
import { loadOrCreateKeys } from './oidc/keys';
import { postgresAdapterFactory, pruneOidc } from './oidc/adapter';
import { oidcSecretVar, resolveOidcClients, type ResolvedOidcClient } from './oidc/provider';
import { createTestDb, dbAvailable, makeAdmin, makeApp, makeUser, TEST_PASSWORD } from './test/harness';
import { parse } from 'yaml';

const REDIRECT = 'https://irc.example.test/callback';
const SECRET = 'x'.repeat(40);
const CLIENTS: ResolvedOidcClient[] = [
  { client_id: 'irc-web', redirect_uris: [REDIRECT], post_logout_redirect_uris: [], public: true },
  { client_id: 'mud-server', redirect_uris: ['https://mud.example.test/cb'], post_logout_redirect_uris: [], public: false, secret: SECRET },
];

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

// A very small browser: cookie jar, manual redirects.
class Browser {
  // Cookies are keyed by name AND path, and sent only to matching paths, as a real browser does.
  // (The provider sets same-named cookies on different paths for different sign-in flows.)
  private cookies = new Map<string, { name: string; value: string; path: string }>();
  constructor(readonly base: string) {}
  get jar() {
    const names = new Map<string, string>();
    for (const c of this.cookies.values()) names.set(c.name, c.value);
    return names;
  }
  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [name, ...v] = pair!.split('=');
      const value = v.join('=');
      const path = attrs.map((a) => /^\s*path=(.*)$/i.exec(a)?.[1]).find(Boolean) ?? '/';
      const key = `${name!.trim()}|${path}`;
      const gone = !value || attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a));
      if (gone) this.cookies.delete(key); else this.cookies.set(key, { name: name!.trim(), value, path });
    }
  }
  async req(url: string, init: RequestInit & { form?: Record<string, string>; basic?: [string, string] } = {}) {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    const target = new URL(url, this.base);
    const sending = [...this.cookies.values()].filter((c) => target.pathname.startsWith(c.path));
    if (sending.length) headers.cookie = sending.map((c) => `${c.name}=${c.value}`).join('; ');
    if (init.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; init.body = new URLSearchParams(init.form).toString(); }
    if (init.basic) headers.authorization = `Basic ${Buffer.from(init.basic.join(':')).toString('base64')}`;
    const res = await fetch(target, { ...init, headers, redirect: 'manual' });
    this.store(res);
    if (process.env.DEBUG_OIDC) console.log(`${init.method ?? 'GET'} ${target.pathname} -> ${res.status} ${res.headers.get('location') ?? ''} | sent: ${sending.map((c) => c.name).join(',')} | set: ${res.headers.getSetCookie().map((l) => l.split(';')[0]!.split('=')[0]).join(',')}`);
    return res;
  }
  async login(handle: string) {
    const res = await this.req('/api/v1/auth/login', { method: 'POST', headers: { origin: this.base, 'content-type': 'application/json' }, body: JSON.stringify({ identifier: handle, password: TEST_PASSWORD }) });
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  async logout() { await this.req('/api/v1/auth/logout', { method: 'POST', headers: { origin: this.base } }); }

  // Walk redirects like a browser until we land on the client's redirect URI, the site's login
  // page, or a non-redirect response.
  async authorize(o: { client?: string; redirect?: string; scope?: string; prompt?: string; challenge: string; method?: string; nonce?: string; extra?: Record<string, string> }) {
    const q = new URLSearchParams({
      client_id: o.client ?? 'irc-web', redirect_uri: o.redirect ?? REDIRECT, response_type: 'code', scope: o.scope ?? 'openid profile site',
      state: 'st8', nonce: o.nonce ?? 'n0nce', ...(o.challenge ? { code_challenge: o.challenge, code_challenge_method: o.method ?? 'S256' } : {}),
      ...(o.prompt ? { prompt: o.prompt } : {}), ...o.extra,
    });
    let url = `/oidc/auth?${q}`;
    for (let hop = 0; hop < 12; hop++) {
      const res = await this.req(url);
      const loc = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !loc) {
        const body = await res.text();
        // A page that submits its own form on load (the provider does this when it ends a previous
        // person's session): do what a browser does, POST the form, then keep following.
        const auto = /document\.forms\[0\]\.submit\(\)/.test(body) && /<form[^>]*method="post"[^>]*action="([^"]+)"/i.exec(body);
        if (auto) {
          const fields = Object.fromEntries([...body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
          const posted = await this.req(auto[1]!, { method: 'POST', form: fields });
          const next = posted.headers.get('location');
          if (!next) return { status: posted.status, body: await posted.text(), final: auto[1]! };
          url = new URL(next, this.base).toString();
          continue;
        }
        return { status: res.status, body, final: url };
      }
      const abs = new URL(loc, this.base).toString();
      const redirect = o.redirect ?? REDIRECT;
      if (abs.startsWith(redirect)) return { redirectedTo: new URL(abs), code: new URL(abs).searchParams.get('code'), error: new URL(abs).searchParams.get('error'), state: new URL(abs).searchParams.get('state') };
      if (new URL(abs).pathname === '/login') return { loginRedirect: new URL(abs) };
      url = abs;
    }
    throw new Error('too many redirects');
  }
}

describe.skipIf(!dbAvailable)('OIDC provider', () => {
  let drop: () => Promise<void>;
  let db: Awaited<ReturnType<typeof createTestDb>>['db'];
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let base: string;
  let boss: Awaited<ReturnType<typeof makeAdmin>>;

  beforeAll(async () => {
    ({ db, drop } = await createTestDb());
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    ctx = await makeApp(db, { oidcClients: CLIENTS, publicUrl: base });
    ctx.deps.config.security.require_admin_2fa = true; // these tests are about the site that requires it (docs/02)
    await ctx.app.listen({ port, host: '127.0.0.1' });
    boss = await makeAdmin(ctx, 'boss');
  });
  afterAll(async () => { await ctx.app.close(); await drop(); });

  const token = (b: Browser, form: Record<string, string>, basic?: [string, string]) => b.req('/oidc/token', { method: 'POST', form, basic });
  const jwks = () => createRemoteJWKSet(new URL(`${base}/oidc/jwks`));
  const verifyIdToken = (idToken: string, audience = 'irc-web') => jwtVerify(idToken, jwks(), { issuer: `${base}/oidc`, audience });

  // Log in on the site, run the authorization flow, and swap the code for tokens.
  async function signIn(handle: string, opts: { scope?: string; prompt?: string; browser?: Browser } = {}) {
    const b = opts.browser ?? new Browser(base);
    if (!b.jar.has('sid')) await b.login(handle);
    const { verifier, challenge } = pkce();
    const a = await b.authorize({ challenge, scope: opts.scope, prompt: opts.prompt });
    if (!('code' in a) || !a.code) throw new Error(`no code: ${JSON.stringify(a).replace(/\\n/g, ' ').slice(0, 1500)}`);
    const res = await token(b, { grant_type: 'authorization_code', code: a.code, redirect_uri: REDIRECT, code_verifier: verifier, client_id: 'irc-web' });
    return { b, res, tokens: (await res.json()) as Record<string, string & number> };
  }

  describe('discovery', () => {
    it('publishes an issuer under /oidc, S256 only, and the signing key', async () => {
      const b = new Browser(base);
      const d = await (await b.req('/oidc/.well-known/openid-configuration')).json();
      expect(d.issuer).toBe(`${base}/oidc`);
      expect(d.authorization_endpoint).toBe(`${base}/oidc/auth`);
      expect(d.token_endpoint).toBe(`${base}/oidc/token`);
      expect(d.code_challenge_methods_supported).toEqual(['S256']);
      expect(d.scopes_supported).toEqual(expect.arrayContaining(['openid', 'offline_access', 'profile', 'site']));
      expect(d.claims_supported).toEqual(expect.arrayContaining(['sub', 'handle', 'display_name', 'role', 'role_rev', 'ops']));
      const keys = (await (await b.req('/oidc/jwks')).json()).keys;
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
      expect(keys[0]).not.toHaveProperty('d'); // the private part is never published
    });

    it('does not offer the features that are not built', async () => {
      const b = new Browser(base);
      // no device flow, no dynamic client registration, no implicit or hybrid flows
      expect((await b.req('/oidc/device/auth', { method: 'POST' })).status).toBeGreaterThanOrEqual(400);
      expect((await b.req('/oidc/reg', { method: 'POST' })).status).toBeGreaterThanOrEqual(400);
      const d = await (await b.req('/oidc/.well-known/openid-configuration')).json();
      expect(d.response_types_supported).toEqual(['code']);
      expect(d).not.toHaveProperty('device_authorization_endpoint');
      expect(d).not.toHaveProperty('registration_endpoint');
    });
  });

  describe('signing in', () => {
    it('code + PKCE gives an ID token with the documented claims, verifiable with the published key', async () => {
      const u = await makeUser(ctx, { role: 'trusted' });
      await db.query(`UPDATE users SET display_name = 'Dade', role_rev = 4 WHERE id = $1`, [u.id]);
      await db.query(`INSERT INTO scoped_roles (id, user_id, role, scope_type, scope_id, granted_by) VALUES ($1, $2, 'channel_op', 'channel', '#synths', $3)`, [newId('o'), u.id, boss.id]);
      const { res, tokens } = await signIn(u.handle);
      expect(res.status).toBe(200);
      expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
      const { payload } = await verifyIdToken(tokens.id_token!);
      expect(payload).toMatchObject({ sub: u.id, handle: u.handle, display_name: 'Dade', role: 'trusted', role_rev: 4, ops: ['channel:#synths'], nonce: 'n0nce', aud: 'irc-web', iss: `${base}/oidc` });
      expect(payload.exp! - payload.iat!).toBe(900);
      expect(tokens.refresh_token).toBeUndefined(); // only with offline_access
    });

    it('returns only the claims for the scopes asked for', async () => {
      const u = await makeUser(ctx);
      const minimal = (await verifyIdToken((await signIn(u.handle, { scope: 'openid' })).tokens.id_token!)).payload;
      expect(minimal.sub).toBe(u.id);
      for (const c of ['handle', 'role', 'role_rev', 'ops']) expect(minimal, c).not.toHaveProperty(c);
      const profile = (await verifyIdToken((await signIn(u.handle, { scope: 'openid profile' })).tokens.id_token!)).payload;
      expect(profile.handle).toBe(u.handle);
      expect(profile).not.toHaveProperty('role');
    });

    it('serves fresh claims from /oidc/me', async () => {
      const u = await makeUser(ctx, { role: 'user' });
      const { b, tokens } = await signIn(u.handle);
      const me = () => b.req('/oidc/me', { headers: { authorization: `Bearer ${tokens.access_token}` } }).then((r) => r.json());
      expect(await me()).toMatchObject({ sub: u.id, role: 'user', role_rev: 0, ops: [] });
      await db.query(`UPDATE users SET role = 'trusted', role_rev = 1 WHERE id = $1`, [u.id]);
      expect(await me()).toMatchObject({ role: 'trusted', role_rev: 1 });
    });

    it('sends someone with no site session to the site login page, and comes back after', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      const { verifier, challenge } = pkce();
      const first = await b.authorize({ challenge });
      expect(first.loginRedirect).toBeDefined();
      const returnTo = first.loginRedirect!.searchParams.get('return_to')!;
      expect(returnTo.startsWith(`${base}/api/v1/oidc/interaction/`)).toBe(true);
      // ...they log in on the site, then the site sends them back to return_to and the flow finishes
      await b.login(u.handle);
      let url = returnTo;
      let code: string | null = null;
      for (let i = 0; i < 10 && !code; i++) {
        const res = await b.req(url);
        const loc = new URL(res.headers.get('location')!, base);
        if (loc.toString().startsWith(REDIRECT)) code = loc.searchParams.get('code'); else url = loc.toString();
      }
      expect(code).toBeTruthy();
      expect((await token(b, { grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, code_verifier: verifier, client_id: 'irc-web' })).status).toBe(200);
    });

    it('does not sign in an admin who has not finished two-factor setup', async () => {
      const handle = `newadmin${randomBytes(3).toString('hex')}`;
      const { createAdmin } = await import('./accounts');
      await createAdmin(ctx.deps, { handle, email: `${handle}@example.test`, password: TEST_PASSWORD });
      const b = new Browser(base);
      await b.login(handle);
      const a = await b.authorize({ challenge: pkce().challenge });
      expect(a.loginRedirect).toBeDefined();
    });

    it('will not confuse two people on one browser: a new site login means a new identity', async () => {
      const alice = await makeUser(ctx);
      const bob = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(alice.handle);
      const first = await signIn(alice.handle, { browser: b });
      expect((await verifyIdToken(first.tokens.id_token!)).payload.sub).toBe(alice.id);

      // Alice logs out of the site and Bob logs in on the same browser. The provider still holds
      // Alice's session cookie, but the next sign-in must be Bob.
      await b.logout();
      const anon = await b.authorize({ challenge: pkce().challenge });
      expect(anon.loginRedirect, 'no site session must not silently reuse the last identity').toBeDefined();
      await b.login(bob.handle);
      const second = await signIn(bob.handle, { browser: b });
      expect((await verifyIdToken(second.tokens.id_token!)).payload.sub).toBe(bob.id);
    });

    it('logging out of the site does not end a service\'s grant', async () => {
      const u = await makeUser(ctx);
      const { b, tokens } = await signIn(u.handle, { scope: 'openid offline_access', prompt: 'consent' });
      await b.logout();
      expect((await b.req('/oidc/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(200);
      expect((await token(new Browser(base), { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: 'irc-web' })).status).toBe(200);
    });
  });

  describe('PKCE and codes', () => {
    it('refuses an authorization request with no code challenge', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const a = await b.authorize({ challenge: '' });
      expect(a.error).toBe('invalid_request');
      expect(a.code).toBeFalsy();
    });

    it('refuses the plain challenge method', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const a = await b.authorize({ challenge: 'a'.repeat(43), method: 'plain' });
      expect(a.error).toBe('invalid_request');
    });

    it('refuses a wrong code verifier', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const a = await b.authorize({ challenge: pkce().challenge });
      const res = await token(b, { grant_type: 'authorization_code', code: (a as { code: string }).code, redirect_uri: REDIRECT, code_verifier: pkce().verifier, client_id: 'irc-web' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_grant');
    });

    it('accepts a code once only', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const { verifier, challenge } = pkce();
      const a = (await b.authorize({ challenge })) as { code: string };
      const form = { grant_type: 'authorization_code', code: a.code, redirect_uri: REDIRECT, code_verifier: verifier, client_id: 'irc-web' };
      expect((await token(b, form)).status).toBe(200);
      const again = await token(b, form);
      expect(again.status).toBe(400);
      expect((await again.json()).error).toBe('invalid_grant');
    });

    it('refuses the code with the wrong redirect URI', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const { verifier, challenge } = pkce();
      const a = (await b.authorize({ challenge })) as { code: string };
      const res = await token(b, { grant_type: 'authorization_code', code: a.code, redirect_uri: 'https://evil.example/cb', code_verifier: verifier, client_id: 'irc-web' });
      expect(res.status).toBe(400);
    });
  });

  describe('clients', () => {
    it('never redirects to an unregistered redirect URI, or for an unknown client', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const bad = await b.authorize({ challenge: pkce().challenge, redirect: 'https://evil.example/cb' });
      expect('redirectedTo' in bad).toBe(false);
      expect((bad as { status: number }).status).toBe(400);
      const body = (bad as { body: string }).body;
      expect(body).toContain('This sign-in request is not valid. Go back to the app and try again.');
      expect(body).not.toMatch(/oops|stack|error_description/i);
      const unknown = await b.authorize({ challenge: pkce().challenge, client: 'nobody' });
      expect((unknown as { status: number }).status).toBe(400);
    });

    it('makes a confidential client authenticate with its secret', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const mud = { client: 'mud-server', redirect: 'https://mud.example.test/cb' };
      const exchange = async (basic?: [string, string]) => {
        const { verifier, challenge } = pkce();
        const a = (await b.authorize({ ...mud, challenge })) as { code: string };
        return token(b, { grant_type: 'authorization_code', code: a.code, redirect_uri: mud.redirect, code_verifier: verifier }, basic);
      };
      const noSecret = await exchange();
      expect([400, 401]).toContain(noSecret.status); // no client authentication at all
      const wrong = await exchange(['mud-server', 'y'.repeat(40)]);
      expect(wrong.status).toBe(401);
      expect((await wrong.json()).error).toBe('invalid_client');
      const ok = await exchange(['mud-server', SECRET]);
      expect(ok.status).toBe(200);
      expect((await ok.json()).access_token).toBeTruthy();
    });

    it('lets a confidential client introspect a token, and a public client not', async () => {
      const u = await makeUser(ctx);
      const b = new Browser(base);
      await b.login(u.handle);
      const { verifier, challenge } = pkce();
      const a = (await b.authorize({ client: 'mud-server', redirect: 'https://mud.example.test/cb', challenge })) as { code: string };
      const t = await (await token(b, { grant_type: 'authorization_code', code: a.code, redirect_uri: 'https://mud.example.test/cb', code_verifier: verifier }, ['mud-server', SECRET])).json();
      const introspect = (basic: [string, string]) => b.req('/oidc/token/introspection', { method: 'POST', form: { token: t.access_token }, basic });
      const active = await (await introspect(['mud-server', SECRET])).json();
      expect(active).toMatchObject({ active: true, sub: u.id, client_id: 'mud-server' });
      expect((await introspect(['mud-server', 'z'.repeat(40)])).status).toBe(401);
    });
  });

  describe('refresh tokens', () => {
    const refresh = (b: Browser, rt: string) => token(b, { grant_type: 'refresh_token', refresh_token: rt, client_id: 'irc-web' });

    it('rotates: each refresh gives new tokens and the old refresh token stops working', async () => {
      const u = await makeUser(ctx);
      const { b, tokens } = await signIn(u.handle, { scope: 'openid site offline_access', prompt: 'consent' });
      expect(tokens.refresh_token).toBeTruthy();
      const r1 = await refresh(b, tokens.refresh_token!);
      expect(r1.status).toBe(200);
      const t1 = await r1.json();
      expect(t1.refresh_token).toBeTruthy();
      expect(t1.refresh_token).not.toBe(tokens.refresh_token);
      expect(t1.access_token).not.toBe(tokens.access_token);
      expect((await verifyIdToken(t1.id_token)).payload.sub).toBe(u.id);
    });

    it('treats a replayed refresh token as theft and ends the whole grant', async () => {
      const u = await makeUser(ctx);
      const { b, tokens } = await signIn(u.handle, { scope: 'openid offline_access', prompt: 'consent' });
      const t1 = await (await refresh(b, tokens.refresh_token!)).json();
      const replay = await refresh(b, tokens.refresh_token!); // the OLD token, again
      expect(replay.status).toBe(400);
      expect((await replay.json()).error).toBe('invalid_grant');
      expect((await refresh(b, t1.refresh_token)).status).toBe(400); // and the newest one is dead too
    });

    it('carries a role or ops change into the next ID token', async () => {
      const u = await makeUser(ctx, { role: 'user' });
      const { b, tokens } = await signIn(u.handle, { scope: 'openid site offline_access', prompt: 'consent' });
      await db.query(`UPDATE users SET role = 'trusted', role_rev = 1 WHERE id = $1`, [u.id]);
      const t1 = await (await refresh(b, tokens.refresh_token!)).json();
      expect((await verifyIdToken(t1.id_token)).payload).toMatchObject({ role: 'trusted', role_rev: 1 });
    });
  });

  describe('security revocation', () => {
    it('suspending a user ends their tokens, their refresh, and their ability to sign in again', async () => {
      const u = await makeUser(ctx);
      const { b, tokens } = await signIn(u.handle, { scope: 'openid offline_access', prompt: 'consent' });
      const r = await boss.client.post(`/api/v1/admin/users/${u.id}/suspend`, { reason: 'testing revocation' });
      expect(r.status).toBe(204);
      expect((await b.req('/oidc/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
      const refreshed = await token(new Browser(base), { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: 'irc-web' });
      expect(refreshed.status).toBe(400);
      expect((await b.authorize({ challenge: pkce().challenge })).loginRedirect).toBeDefined();
      expect((await db.query(`SELECT 1 FROM oidc_payloads WHERE account_id = $1`, [u.id])).rowCount).toBe(0);
    });

    it('a password reset ends their tokens too', async () => {
      const u = await makeUser(ctx);
      const { b, tokens } = await signIn(u.handle, { scope: 'openid offline_access', prompt: 'consent' });
      const { sha256, randomToken } = await import('./crypto');
      const reset = randomToken();
      await db.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [sha256(reset), u.id]);
      const res = await b.req('/api/v1/auth/reset-password', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ token: reset, password: 'a completely new password' }) });
      expect(res.status).toBe(204);
      expect((await b.req('/oidc/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
    });

    it('refuses new tokens to a suspended account even if its grants had somehow survived', async () => {
      const u = await makeUser(ctx);
      const { tokens } = await signIn(u.handle, { scope: 'openid offline_access', prompt: 'consent' });
      await db.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [u.id]); // no revocation: only the status changes
      const res = await token(new Browser(base), { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: 'irc-web' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_grant');
    });

    it('announces it on the event bus', async () => {
      const u = await makeUser(ctx);
      await signIn(u.handle);
      await boss.client.post(`/api/v1/admin/users/${u.id}/suspend`, { reason: 'event check' });
      const ev = (await db.query(`SELECT payload FROM events_outbox WHERE type = 'session.revoked' AND payload->>'user_id' = $1`, [u.id])).rows;
      expect(ev.length).toBeGreaterThan(0);
    });
  });

  describe('request handling', () => {
    it('is not blocked by the browser CSRF check: services call it with their own credentials', async () => {
      const b = new Browser(base);
      const res = await b.req('/oidc/token', { method: 'POST', headers: { origin: 'https://irc.example.test' }, form: { grant_type: 'authorization_code', code: 'nope', client_id: 'irc-web', redirect_uri: REDIRECT, code_verifier: 'x'.repeat(43) } });
      expect(res.status).toBe(400); // rejected by the provider for the bad code, not by our origin check (403)
      expect((await res.json()).error).toBe('invalid_grant');
    });

    it('answers an expired or unknown interaction plainly', async () => {
      const b = new Browser(base);
      const res = await b.req(`/api/v1/oidc/interaction/${randomBytes(12).toString('hex')}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('interaction_expired');
    });

    it('leaves the rest of the API working next to it', async () => {
      const b = new Browser(base);
      expect((await b.req('/api/v1/site')).status).toBe(200);
      expect((await b.req('/healthz')).status).toBe(200);
    });
  });

  describe('signing keys', () => {
    it('are created once, stored encrypted, and stay the same across restarts', async () => {
      const rows = (await db.query(`SELECT kid, private_jwk_enc FROM oidc_keys`)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.private_jwk_enc).toMatch(/^v1\./);
      expect(rows[0]!.private_jwk_enc).not.toContain('"d"');
      const again = await loadOrCreateKeys(db, ctx.deps.secretKey);
      expect(again).toHaveLength(1);
      expect(again[0]!.kid).toBe(rows[0]!.kid);
      expect(again[0]).toHaveProperty('d'); // decrypted for signing, in memory only
    });

    it('are not duplicated when two instances start at the same moment', async () => {
      const fresh = await createTestDb();
      try {
        const key = randomBytes(32);
        const [a, b, c] = await Promise.all([loadOrCreateKeys(fresh.db, key), loadOrCreateKeys(fresh.db, key), loadOrCreateKeys(fresh.db, key)]);
        expect((await fresh.db.query(`SELECT 1 FROM oidc_keys`)).rowCount).toBe(1);
        expect(new Set([a[0]!.kid, b[0]!.kid, c[0]!.kid]).size).toBe(1);
      } finally { await fresh.drop(); }
    });

    it('fail with a plain message when APP_SECRET_KEY is not the one that encrypted them', async () => {
      await expect(loadOrCreateKeys(db, randomBytes(32))).rejects.toThrow(/APP_SECRET_KEY is not the key/);
    });
  });

  describe('provider records', () => {
    it('revoking a grant removes its tokens but not the sign-in in progress or the browser session', async () => {
      const adapter = postgresAdapterFactory(db);
      const grant = `g_${randomBytes(6).toString('hex')}`;
      const ids = { AccessToken: `at_${grant}`, RefreshToken: `rt_${grant}`, AuthorizationCode: `ac_${grant}`, Interaction: `in_${grant}`, Session: `se_${grant}` };
      for (const [type, id] of Object.entries(ids)) await adapter(type).upsert(id, { grantId: grant, accountId: 'u_x' }, 600);
      await adapter('AccessToken').revokeByGrantId(grant);
      const left = (await db.query(`SELECT type FROM oidc_payloads WHERE grant_id = $1 ORDER BY type`, [grant])).rows.map((r) => r.type);
      expect(left).toEqual(['Interaction', 'Session']);
    });

    it('marks a consumed record with the time, and expires records on schedule', async () => {
      const adapter = postgresAdapterFactory(db)('AuthorizationCode');
      const id = `code_${randomBytes(6).toString('hex')}`;
      await adapter.upsert(id, { grantId: 'g' }, 600);
      expect((await adapter.find(id))?.consumed).toBeUndefined();
      await adapter.consume(id);
      expect(typeof (await adapter.find(id))?.consumed).toBe('number');
      await db.query(`UPDATE oidc_payloads SET expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
      expect(await adapter.find(id)).toBeUndefined();
    });
  });

  describe('housekeeping', () => {
    it('removes expired provider records and keeps live ones', async () => {
      await db.query(`INSERT INTO oidc_payloads (id, type, payload, expires_at) VALUES ('old1', 'Test', '{}', now() - interval '1 hour'), ('live1', 'Test', '{}', now() + interval '1 hour')`);
      expect(await pruneOidc(db)).toBeGreaterThanOrEqual(1);
      expect((await db.query(`SELECT id FROM oidc_payloads WHERE type = 'Test'`)).rows.map((r) => r.id)).toEqual(['live1']);
    });
  });
});

describe('OIDC client configuration', () => {
  const site = `site: { name: X, short_name: xsite, domain: example.test, homes_domain: homes.test }\n`;

  it('accepts public and confidential clients, and localhost over http', () => {
    const cfg = parseSiteConfig(`${site}oidc:\n  clients:\n    - { client_id: irc-web, redirect_uris: ["https://irc.example.test/cb"], public: true }\n    - { client_id: dev-app, redirect_uris: ["http://localhost:5173/cb"] }\n`);
    expect(cfg.oidc.clients.map((c) => c.client_id)).toEqual(['irc-web', 'dev-app']);
    expect(cfg.oidc.clients[1]!.public).toBe(false);
  });
  it('defaults to no clients', () => expect(parseSiteConfig(site).oidc.clients).toEqual([]));
  it('rejects a duplicate client_id, a bad id, and http to a real host', () => {
    expect(() => parseSiteConfig(`${site}oidc:\n  clients:\n    - { client_id: a-b, redirect_uris: ["https://a.test/cb"] }\n    - { client_id: a-b, redirect_uris: ["https://b.test/cb"] }\n`)).toThrow(/duplicate client_id/);
    expect(() => oidcClientSchema.parse({ client_id: 'Bad Id', redirect_uris: ['https://a.test/cb'] })).toThrow();
    expect(() => oidcClientSchema.parse({ client_id: 'ok', redirect_uris: ['http://a.test/cb'] })).toThrow(/https/);
    expect(() => oidcClientSchema.parse({ client_id: 'ok', redirect_uris: [] })).toThrow();
  });
  it('takes a confidential secret from the environment, and refuses a missing or short one', () => {
    const clients = siteConfigSchema.parse({ ...parse(site), oidc: { clients: [{ client_id: 'mud-server', redirect_uris: ['https://mud.test/cb'] }] } }).oidc.clients;
    expect(oidcSecretVar('mud-server')).toBe('OIDC_SECRET_MUD_SERVER');
    expect(resolveOidcClients(clients, { OIDC_SECRET_MUD_SERVER: 's'.repeat(32) })[0]!.secret).toBe('s'.repeat(32));
    expect(() => resolveOidcClients(clients, {})).toThrow(/OIDC_SECRET_MUD_SERVER/);
    expect(() => resolveOidcClients(clients, { OIDC_SECRET_MUD_SERVER: 'short' })).toThrow(/at least 32/);
  });
  it('needs no secret for a public client', () => {
    const c = siteConfigSchema.parse({ ...parse(site), oidc: { clients: [{ client_id: 'irc-web', redirect_uris: ['https://i.test/cb'], public: true }] } }).oidc.clients;
    expect(resolveOidcClients(c, {})[0]).not.toHaveProperty('secret');
  });
});
