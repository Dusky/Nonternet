import { expect, test } from '../support/fixtures';
import { BASE_URL } from '../support/stack';
import { linkFor, loginViaUi, logoutViaUi, makeAdmin, makeUser, PASSWORD, totp, uniq } from '../support/helpers';

test.describe('logging in', () => {
  test('says plainly when the handle or password is wrong, without revealing which', async ({ page }) => {
    const u = await makeUser(page);
    await page.goto('/login');
    await page.getByLabel('Handle or email').fill(u.handle);
    await page.getByLabel('Password', { exact: true }).fill('not the password');
    await page.getByRole('button', { name: 'Log in' }).click();
    const wrong = await page.getByRole('alert').textContent();
    await page.getByLabel('Handle or email').fill('nobody-here');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toHaveText('That handle, email or password is not right.');
    expect(wrong).toBe('That handle, email or password is not right.');
  });

  test('asks for the two-factor code, refuses a wrong one, and will not take the same code twice', async ({ page }) => {
    const admin = await makeAdmin(page);
    await page.goto('/login');
    await page.getByLabel('Handle or email').fill(admin.handle);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Enter the 6-digit code from your authenticator app.')).toBeVisible();
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toContainText('That code is not right');

    const code = await totp(admin.secret, 1); // the next 30 s step: valid now, and newer than the one used to turn it on
    await page.getByLabel('6-digit code').fill(code);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('button', { name: `Account menu for ${admin.handle}` })).toBeVisible();

    await logoutViaUi(page, admin.handle);
    await loginViaUi(page, admin.handle, PASSWORD, { totp: code });
    await expect(page.getByRole('alert')).toContainText('already used');
  });

  test('takes a recovery code once', async ({ page }) => {
    const admin = await makeAdmin(page);
    const code = admin.recoveryCodes[0]!;
    await loginViaUi(page, admin.handle, PASSWORD, { recovery: code });
    await expect(page.getByRole('button', { name: `Account menu for ${admin.handle}` })).toBeVisible();
    await logoutViaUi(page, admin.handle);
    await loginViaUi(page, admin.handle, PASSWORD, { recovery: code });
    await expect(page.getByRole('alert')).toContainText('not right, or it was already used');
  });

  test('an admin without two-factor is held at its setup and cannot open the admin console', async ({ page }) => {
    const admin = await makeAdmin(page, { withTotp: false });
    await loginViaUi(page, admin.handle, PASSWORD);
    await expect(page).toHaveURL(/\/setup-2fa$/);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/setup-2fa$/);
  });
});

test.describe('where you end up after logging in', () => {
  test('a signed-out visit to a page goes to login and back to that page', async ({ page }) => {
    const admin = await makeAdmin(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login\?return_to=%2Fadmin$/);
    await loginViaUi(page, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! }).catch(() => undefined);
    // loginViaUi opens /login fresh, which drops return_to, so do it by hand here
    await page.goto('/admin');
    await page.getByLabel('Handle or email').fill(admin.handle);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
    await page.getByLabel('Recovery code').fill(admin.recoveryCodes[1]!);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/admin(\/users)?$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Admin console' })).toBeVisible();
  });

  test('a return_to that points at another site is ignored', async ({ page }) => {
    const u = await makeUser(page);
    await page.goto(`/login?return_to=${encodeURIComponent('https://evil.example/phish')}`);
    await page.getByLabel('Handle or email').fill(u.handle);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(BASE_URL);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('someone already signed in who opens the login page is sent on', async ({ page }) => {
    const u = await makeUser(page);
    await loginViaUi(page, u.handle, PASSWORD);
    await expect(page.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible();
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
  });

  test('a user who is not an admin is told so', async ({ page }) => {
    const u = await makeUser(page);
    await loginViaUi(page, u.handle, PASSWORD);
    await expect(page.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible(); // signed in before we navigate away
    await page.goto('/admin');
    await expect(page.getByText('Only admins can see this.')).toBeVisible();
  });

  test('an unknown address gets a plain not-found page', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'That page does not exist.' })).toBeVisible();
  });
});

test.describe('signing up', () => {
  test('catches mistakes before sending anything, and points at the field', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Invite code').fill('SOME-CODE');
    await page.getByLabel('Handle').fill('1bad');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText(/handle must be 2/i)).toBeVisible();
    await expect(page.getByText(/password must be at least 10/i)).toBeVisible();
    await expect(page.getByLabel('Handle')).toHaveAttribute('aria-invalid', 'true');
  });

  test('says when the invite code is not valid, next to the invite field', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Invite code').fill('NOPE-NOPE-NOPE');
    await page.getByLabel('Handle').fill(uniq('someone'));
    await page.getByLabel('Email').fill(`${uniq('mail')}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText('That invite code is not valid. Ask for a new one.')).toBeVisible();
    await expect(page.getByLabel('Invite code')).toHaveAttribute('aria-invalid', 'true');
  });

  test('says when the handle is taken', async ({ page }) => {
    const existing = await makeUser(page);
    const code = `E2E-${uniq('inv').toUpperCase()}`;
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const pg = (await import('pg')).default;
    const { TMP } = await import('../support/stack');
    const db = new pg.Client({ connectionString: JSON.parse(readFileSync(join(TMP, 'stack.json'), 'utf8')).DATABASE_URL });
    await db.connect();
    await db.query(`INSERT INTO invites (code, created_by, expires_at) SELECT $1, id, now() + interval '1 day' FROM users WHERE role = 'admin' LIMIT 1`, [code]);
    await db.end();
    await page.goto(`/signup?invite=${code}`);
    await page.getByLabel('Handle').fill(existing.handle.toUpperCase());
    await page.getByLabel('Email').fill(`${uniq('other')}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText('That handle is not available. Choose another.')).toBeVisible();
  });
});

test.describe('forgotten and changed passwords', () => {
  test('a reset link sets a new password once', async ({ page }) => {
    const u = await makeUser(page);
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(u.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/reset link is on its way/)).toBeVisible();
    const link = await linkFor(u.email, 'reset-password');

    await page.goto(link);
    await page.getByLabel('New password').fill('a much longer new password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Your password is changed. Log in with the new one.')).toBeVisible();

    await page.goto(link);
    await page.getByLabel('New password').fill('yet another long password');
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByRole('alert')).toContainText('expired or was already used');

    await loginViaUi(page, u.handle, 'a much longer new password');
    await expect(page.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible();
  });

  test('gives the same answer for an address with no account', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(`${uniq('ghost')}@example.test`);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/reset link is on its way/)).toBeVisible();
  });

  test('changing your password in Settings signs your other devices out', async ({ page, browser, isMobile }) => {
    const u = await makeUser(page);
    await loginViaUi(page, u.handle, PASSWORD);
    const other = await browser.newContext({ baseURL: BASE_URL });
    const otherPage = await other.newPage();
    await loginViaUi(otherPage, u.handle, PASSWORD);
    await expect(otherPage.getByRole('button', { name: `Account menu for ${u.handle}` })).toBeVisible();
    expect((await other.request.get('/api/v1/me')).status()).toBe(200);

    if (isMobile) await page.getByRole('link', { name: 'Settings' }).click();
    else await page.getByRole('button', { name: 'Open Settings' }).click();
    const scope = isMobile ? page.locator('main') : page.getByRole('dialog', { name: 'Settings window' });
    await scope.getByRole('link', { name: 'Password' }).click();
    await scope.getByLabel('Current password').fill('wrong password here');
    await scope.getByLabel('New password').fill('a much longer new password');
    await scope.getByRole('button', { name: 'Password' }).click();
    await expect(scope.getByRole('alert')).toHaveText('That is not your current password.');
    await scope.getByLabel('Current password').fill(PASSWORD);
    await scope.getByRole('button', { name: 'Password' }).click();
    await expect(scope.getByText('Password changed. Your other sessions were signed out.')).toBeVisible();

    expect((await page.context().request.get('/api/v1/me')).status()).toBe(200); // this device stays signed in
    expect((await other.request.get('/api/v1/me')).status()).toBe(401);
    await other.close();
  });
});
