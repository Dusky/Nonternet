import { expect, test } from '../support/fixtures';
import type { Locator, Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { linkFor, loginViaUi, makeAdmin, PASSWORD, totp, uniq } from '../support/helpers';
import { TMP } from '../support/stack';

// Roadmap M1 acceptance: "fresh setup -> admin invites a user -> user signs up -> admin promotes ->
// audit shows all; works on phone." This runs it for real, once as a desktop and once as a phone.

const shot = async (page: Page, name: string, project: string) => {
  mkdirSync(join(TMP, 'shots'), { recursive: true });
  await page.screenshot({ path: join(TMP, 'shots', `${project}-${name}.png`), fullPage: false });
};
// A phone must never scroll sideways.
const noSidewaysScroll = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

async function openApp(page: Page, isMobile: boolean, app: 'Settings' | 'Admin console'): Promise<Locator> {
  if (isMobile) {
    await page.getByRole('link', { name: app }).click();
    return page.locator('main');
  }
  await page.getByRole('button', { name: `Open ${app}` }).click();
  return page.getByRole('dialog', { name: `${app} window` });
}

async function logout(page: Page, handle: string) {
  await page.getByRole('button', { name: `Account menu for ${handle}` }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
}

test('an admin invites someone, they sign up, and the admin promotes them', async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const isMobile = project === 'phone';
  const admin = await makeAdmin(page, { withTotp: false });
  const reason = `active for ${uniq('weeks')}`; // both projects share a database, so the audit log holds both runs

  // -- the admin's first login stops at two-factor setup
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'E2E Test Site' })).toBeVisible();
  await shot(page, '01-landing', project);
  await noSidewaysScroll(page);
  await loginViaUi(page, admin.handle, PASSWORD);
  await expect(page).toHaveURL(/\/setup-2fa$/);
  await expect(page.getByRole('heading', { name: 'Set up two-factor authentication' })).toBeVisible();
  await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
  await shot(page, '02-setup-2fa', project);
  await noSidewaysScroll(page);
  const secret = (await page.locator('code.secret').textContent())!.trim();
  await page.getByLabel('Enter the 6-digit code it shows').fill(await totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();

  // -- recovery codes are shown once, and you can't move on until you say you have them
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const codes = await page.locator('.codes code').allTextContents();
  expect(codes).toHaveLength(10);
  const proceed = page.getByRole('button', { name: 'Continue' });
  await expect(proceed).toBeDisabled();
  await page.getByLabel('I have saved these codes').check();
  await shot(page, '03-recovery-codes', project);
  await proceed.click();
  await expect(page).toHaveURL(/\/$/);

  // -- the admin creates an invite
  let scope = await openApp(page, isMobile, 'Admin console');
  await shot(page, '04-admin-console', project);
  await scope.getByRole('link', { name: 'Invites' }).click();
  await scope.getByRole('button', { name: 'Create invite' }).click();
  const invite = /([A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4})/.exec((await scope.getByTestId('new-invite').textContent()) ?? '')![1]!;
  await shot(page, '05-invite-created', project);
  await noSidewaysScroll(page);
  await logout(page, admin.handle);

  // -- a new person signs up with the invite
  const handle = uniq('zerocool');
  const email = `${handle}@example.test`;
  await page.goto(`/signup?invite=${invite}`);
  await expect(page.getByLabel('Invite code')).toHaveValue(invite);
  await page.getByLabel('Handle').fill(handle);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Account created. Check your email to confirm your address.')).toBeVisible();
  await shot(page, '06-signed-up', project);

  // -- the emailed link confirms the address, once
  const link = await linkFor(email, 'verify-email');
  await page.goto(link);
  await expect(page.getByText('Your email is confirmed. You can log in now.')).toBeVisible();
  await page.goto(link);
  await expect(page.getByText('That link has expired or was already used.')).toBeVisible();

  // -- they log in and change their display name
  await loginViaUi(page, handle, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  scope = await openApp(page, isMobile, 'Settings');
  await shot(page, '07-settings', project);
  await scope.getByLabel('Display name (optional)').fill('Zero Cool');
  await scope.getByRole('button', { name: 'Save' }).click();
  await expect(scope.getByText('Profile saved.')).toBeVisible();
  await noSidewaysScroll(page);
  await logout(page, handle);

  // -- the admin logs back in (with a recovery code), finds them and promotes them
  await loginViaUi(page, admin.handle, PASSWORD, { recovery: codes[0]! });
  await expect(page).toHaveURL(/\/$/);
  scope = await openApp(page, isMobile, 'Admin console');
  await scope.getByLabel('Search users').fill(handle);
  await scope.getByRole('link', { name: handle }).click();
  await expect(scope.getByRole('heading', { level: 2, name: new RegExp(`${handle}\\s+User`) })).toBeVisible();
  await shot(page, '08-dossier', project);
  await noSidewaysScroll(page);
  await scope.getByLabel('Role', { exact: true }).selectOption('trusted');
  await scope.getByLabel('Reason').first().fill(reason);
  await scope.getByRole('button', { name: 'Apply' }).click();
  await expect(scope.getByRole('heading', { level: 2, name: new RegExp(`${handle}\\s+Trusted`) })).toBeVisible();

  // -- and the audit log shows all of it
  await scope.getByRole('link', { name: 'Audit log' }).click();
  for (const action of ['user.role_changed', 'invite.created', 'user.created', 'user.email_verified', 'user.totp_enabled']) {
    await expect(scope.getByText(action, { exact: true }).first(), action).toBeVisible();
  }
  const entry = scope.getByRole('listitem').filter({ hasText: reason });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('user.role_changed');
  await expect(entry).toContainText('user \u2192 trusted');
  await expect(entry).toContainText(`by ${admin.handle}`);
  await shot(page, '09-audit', project);
  await noSidewaysScroll(page);
});
