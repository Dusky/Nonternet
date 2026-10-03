import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { linkFor, makeAdmin, makeUser, signIn, totp, uniq } from '../support/helpers';

// What people can do for themselves (docs/02): change their email and handle, and turn two-factor off.
const axe = async (page: import('@playwright/test').Page) =>
  (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => v.id);

test('someone changes their email address and handle from Settings', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, u.password);
  await page.goto('/settings/account');
  const email = page.getByRole('region', { name: 'Email address' });
  await expect(email.getByText(`Your email address is ${u.email}.`)).toBeVisible();
  const fresh = `${uniq('new')}@example.test`;
  await email.getByLabel('New email address').fill(fresh);
  await email.getByLabel('Current password').fill(u.password);
  await email.getByRole('button', { name: 'Change email address' }).click();
  await expect(email.getByText(`We sent a link to ${fresh}.`, { exact: false })).toBeVisible();

  const handle = page.getByRole('region', { name: 'Handle' });
  const renamed = uniq('re');
  await handle.getByLabel('New handle').fill(renamed);
  await expect(handle.getByText(`Your homepage will be at ${renamed}.`, { exact: false })).toBeVisible();
  await handle.getByLabel('Current password').fill(u.password);
  expect(await axe(page)).toEqual([]);
  await handle.getByRole('button', { name: 'Change handle' }).click();
  await expect(handle.getByText('Your handle is changed.')).toBeVisible();
  await expect(handle.getByText(/You can change your handle again on/)).toBeVisible();

  await page.goto(await linkFor(fresh, 'confirm-email'));
  await expect(page.getByText('Your email address is changed.')).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.goto('/settings/account');
  await expect(page.getByText(`Your email address is ${fresh}.`)).toBeVisible();
  await expect(page.getByText(`Your handle is ${renamed}.`)).toBeVisible();
});

test('someone turns two-factor off', async ({ page }) => {
  const admin = await makeAdmin(page); // the quickest person with two-factor on; this site doesn't require it for admins
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  await page.goto('/settings/two-factor');
  await page.getByRole('button', { name: 'Turn off two-factor' }).click();
  await page.getByLabel('Current password').fill(admin.password);
  await page.getByLabel('6-digit code or recovery code').fill(admin.recoveryCodes[0]!);
  expect(await axe(page)).toEqual([]);
  await page.getByRole('button', { name: 'Turn off', exact: true }).click();
  await expect(page.getByText('Two-factor authentication is off.')).toBeVisible();
});
