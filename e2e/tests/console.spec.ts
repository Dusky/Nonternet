import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { makeAdmin, makeUser, signIn, totp } from '../support/helpers';

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

for (const theme of ['webring', 'terminal'] as const) test(`an admin uses the command console, then replays what it did, and reads the stats (${theme})`, async ({ page }) => {
  await page.addInitScript((th) => localStorage.setItem('ui:theme', th), theme);
  const u = await makeUser(page);
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });

  await page.goto('/admin/console');
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('user sh');
  await input.press('Tab');
  await expect(input).toHaveValue('user show ');
  await input.fill(`user role ${u.handle} trusted --reason "helps everyone"`);
  await input.press('Enter');
  await expect(page.getByRole('log').getByText(`${u.handle} is now trusted.`)).toBeVisible();
  await input.fill('help');
  await input.press('Enter');
  await expect(page.getByRole('log').getByRole('cell', { name: 'stats', exact: true })).toBeVisible();
  await input.press('ArrowUp');
  await expect(input).toHaveValue('help');
  await scan(page, 'the command console');

  await page.goto('/admin/audit');
  await page.getByRole('link', { name: `Replay the history of ${u.id}` }).first().click();
  await expect(page.getByRole('heading', { name: `History of user ${u.id}` })).toBeVisible();
  const diff = page.getByRole('table');
  await expect(diff.getByRole('rowheader', { name: 'role' })).toBeVisible();
  await expect(diff.getByText('trusted')).toBeVisible();
  await scan(page, 'the audit replay');

  await page.goto('/admin/stats');
  await expect(page.getByRole('img', { name: /people active each day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'When people post' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download retention as CSV' })).toHaveAttribute('href', /kind=cohorts/);
  await scan(page, 'the stats');
});
