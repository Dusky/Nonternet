import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL, OIDC_CALLBACK } from '../support/stack';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// The provider (core) and the login page (shell) meeting for real: a service sends someone off to
// sign in, the site's own login page handles it, and the service gets a code it can exchange.

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const authorizeUrl = (challenge: string, state: string, scope = 'openid profile site') =>
  `${BASE_URL}/oidc/auth?${new URLSearchParams({ client_id: 'e2e-app', redirect_uri: OIDC_CALLBACK, response_type: 'code', scope, state, nonce: 'n-1', code_challenge: challenge, code_challenge_method: 'S256' })}`;

// The callback is the service's address, not ours. Answer it ourselves so the test can read the code.
const stubCallback = (page: Page) => page.route(`${OIDC_CALLBACK}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>callback</p>' }));

async function exchange(page: Page, code: string, verifier: string) {
  const res = await page.request.post('/oidc/token', { form: { grant_type: 'authorization_code', code, redirect_uri: OIDC_CALLBACK, code_verifier: verifier, client_id: 'e2e-app' } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { id_token: string; access_token: string; expires_in: number };
}

test.describe('signing in for a service', () => {
  test.skip(({ isMobile }) => isMobile, 'the flow is the same on a phone; the login page itself is covered there');

  test('sends a signed-out person to the login page, then back with a code the service can use', async ({ page }) => {
    const u = await makeUser(page);
    await stubCallback(page);
    const { verifier, challenge } = pkce();
    await page.goto(authorizeUrl(challenge, 'state-1'));

    await expect(page).toHaveURL(/\/login\?return_to=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get('return_to')!)).toContain('/api/v1/oidc/interaction/');
    await page.getByLabel('Handle or email').fill(u.handle);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();

    await page.waitForURL(new RegExp(`^${OIDC_CALLBACK}\\?`), { waitUntil: 'commit' });
    const back = new URL(page.url());
    expect(back.searchParams.get('state')).toBe('state-1');
    const code = back.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const tokens = await exchange(page, code, verifier);
    expect(tokens.expires_in).toBe(900);
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(`${BASE_URL}/oidc/jwks`)), { issuer: `${BASE_URL}/oidc`, audience: 'e2e-app' });
    expect(payload).toMatchObject({ sub: u.id, handle: u.handle, role: 'user', role_rev: 1, ops: [], nonce: 'n-1' });

    const me = await (await page.request.get('/oidc/me', { headers: { authorization: `Bearer ${tokens.access_token}` } })).json();
    expect(me).toMatchObject({ sub: u.id, handle: u.handle, role: 'user' });
  });

  test('does not ask someone who is already signed in to log in again', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await stubCallback(page);
    const { verifier, challenge } = pkce();
    await page.goto(authorizeUrl(challenge, 'state-2'));
    await page.waitForURL(new RegExp(`^${OIDC_CALLBACK}\\?`), { waitUntil: 'commit' });
    const code = new URL(page.url()).searchParams.get('code')!;
    const tokens = await exchange(page, code, verifier);
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(`${BASE_URL}/oidc/jwks`)), { issuer: `${BASE_URL}/oidc`, audience: 'e2e-app' });
    expect(payload.sub).toBe(u.id);
  });

  test('goes to the person who is signed in now, not whoever signed in last on this browser', async ({ page }) => {
    const alice = await makeUser(page);
    const bob = await makeUser(page);
    await stubCallback(page);
    await signIn(page, alice.handle, PASSWORD);
    const first = pkce();
    await page.goto(authorizeUrl(first.challenge, 's-a'));
    await page.waitForURL(new RegExp(`^${OIDC_CALLBACK}\\?`), { waitUntil: 'commit' });
    const a = await exchange(page, new URL(page.url()).searchParams.get('code')!, first.verifier);
    const aliceClaims = await jwtVerify(a.id_token, createRemoteJWKSet(new URL(`${BASE_URL}/oidc/jwks`)), { issuer: `${BASE_URL}/oidc`, audience: 'e2e-app' });
    expect(aliceClaims.payload.sub).toBe(alice.id);

    await page.goto('/');
    await page.getByRole('button', { name: `Account menu for ${alice.handle}` }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    await signIn(page, bob.handle, PASSWORD);

    const second = pkce();
    await page.goto(authorizeUrl(second.challenge, 's-b'));
    await page.waitForURL(new RegExp(`^${OIDC_CALLBACK}\\?`), { waitUntil: 'commit' });
    const b = await exchange(page, new URL(page.url()).searchParams.get('code')!, second.verifier);
    const bobClaims = await jwtVerify(b.id_token, createRemoteJWKSet(new URL(`${BASE_URL}/oidc/jwks`)), { issuer: `${BASE_URL}/oidc`, audience: 'e2e-app' });
    expect(bobClaims.payload.sub).toBe(bob.id);
  });

  test('shows a plain page, and does not redirect, when the service asks for an address it is not registered for', async ({ page }) => {
    const { challenge } = pkce();
    const url = authorizeUrl(challenge, 'x').replace(encodeURIComponent(OIDC_CALLBACK), encodeURIComponent('https://evil.example/cb'));
    const res = await page.goto(url);
    expect(res!.status()).toBe(400);
    await expect(page.getByText('This sign-in request is not valid. Go back to the app and try again.')).toBeVisible();
    expect(new URL(page.url()).origin).toBe(BASE_URL);
  });
});
