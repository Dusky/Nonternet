import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD } from '../support/helpers';
import { SHELL_PORT } from '../support/stack';

// Passkeys (docs/02), with Chrome's virtual authenticator standing in for a phone or security key. A passkey can't
// belong to an IP address, so these pages are opened as localhost, which core accepts for a local 127.0.0.1 site.
const LOCAL = `http://localhost:${SHELL_PORT}`;

test('add a passkey after the password, log in with it alone, and remove it with Undo', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const u = await makeUser(page);

  await page.goto(`${LOCAL}/login`);
  await page.getByLabel('Handle or email').fill(u.handle);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible();

  await page.goto(`${LOCAL}/settings/passkeys`);
  await expect(page.getByText('No passkeys yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await page.getByLabel('Name').fill('Test key');
  await page.getByLabel('Current password').fill('not my password');
  await page.getByRole('button', { name: 'Make the passkey' }).click();
  await expect(page.getByText('That is not your current password.')).toBeVisible(); // nothing made without it
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Make the passkey' }).click();
  await expect(page.getByText('Test key')).toBeVisible();
  await expect(page.getByText('not used yet')).toBeVisible();

  // Signed out, the passkey alone signs back in: no handle, password or code. Where the browser can, it offers the
  // passkey under the handle field; the virtual authenticator picks that suggestion at once.
  await page.context().clearCookies();
  await page.goto(`${LOCAL}/login`);
  await expect(page.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible();

  // Where it can't, the button does the same.
  await page.context().clearCookies();
  await page.addInitScript(() => { PublicKeyCredential.isConditionalMediationAvailable = async () => false; });
  await page.goto(`${LOCAL}/login`);
  await page.getByRole('button', { name: 'Use a passkey' }).click();
  await expect(page.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible();

  await page.goto(`${LOCAL}/settings/passkeys`);
  await expect(page.getByText(/last used/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove the passkey Test key' }).click();
  await expect(page.getByText('No passkeys yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Test key', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove the passkey Test key' }).click();
  const count = async () => (await (await page.request.get(`${LOCAL}/api/v1/me/passkeys`)).json()).passkeys.length as number;
  await expect.poll(count, { timeout: 15_000 }).toBe(0);
});
