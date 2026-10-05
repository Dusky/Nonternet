import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// Forms (docs/10): a field's mistake shows when you leave it and goes as you fix it; the button stays on, and
// pressing it with mistakes shows all of them.
test('sign-up: a mistake shows on leaving the field, goes when fixed, and the button is never off', async ({ page }) => {
  await page.goto('/signup');
  const handle = page.getByLabel('Handle');
  await handle.fill('1bad');
  await expect(page.getByText(/handle must be 2/i)).toHaveCount(0); // not while typing in it for the first time
  await page.getByLabel('Email').focus();                            // leaving the field
  await expect(page.getByText(/handle must be 2/i)).toBeVisible();
  await expect(handle).toHaveAttribute('aria-invalid', 'true');
  await handle.fill('fine_name');
  await expect(page.getByText(/handle must be 2/i)).toHaveCount(0);  // goes as it is fixed
  await expect(page.getByRole('button', { name: 'Sign up' })).toBeEnabled();
});

test('forgot password: says what is wrong with the address, in a sentence', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill('nope');
  await page.getByRole('button', { name: /send/i }).click();
  await expect(page.getByText('That email address does not look right.')).toBeVisible();
});

test('changing your password: the new one is checked as you leave it, and a wrong current one is said once, at the bottom', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/password');
  await page.getByLabel('New password').fill('short');
  await page.getByLabel('Current password').focus();
  await expect(page.getByText(/must be at least 10/i)).toBeVisible();
  await page.getByLabel('New password').fill('a perfectly long new password');
  await page.getByLabel('Current password').fill('not my password');
  await page.getByRole('button', { name: 'Password' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});
