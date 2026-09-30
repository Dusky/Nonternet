import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { loginViaUi, makeUser, PASSWORD, signIn } from '../support/helpers';

const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test.describe('your data', () => {
  test('a person asks for an export, and downloads a signed archive of what they made', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.request.post('/api/v1/homes/me/template', { data: { template: 'about-me' }, headers: h });
    await page.goto('/settings/data');
    await page.getByLabel('Your password').first().fill('wrong password');
    await page.getByRole('button', { name: 'Ask for an export' }).click();
    await expect(page.getByRole('alert')).toContainText('That is not your password.');
    await page.getByLabel('Your password').first().fill(PASSWORD);
    await page.getByRole('button', { name: 'Ask for an export' }).click();
    await expect(page.getByText('Requested. We will email you when it is ready.')).toBeVisible();
    // The worker builds it within a few seconds and the page picks that up on its own.
    const link = page.getByRole('link', { name: /^Download / });
    await expect(link).toBeVisible({ timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${u.handle}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
    const res = await page.request.get((await link.getAttribute('href'))!);
    expect(res.ok()).toBe(true);
    const bytes = await res.body();
    expect(bytes.subarray(0, 2).toString()).toBe('PK'); // a zip
    expect(bytes.length).toBeGreaterThan(500);
    // One a day.
    await page.reload();
    await page.getByLabel('Your password').first().fill(PASSWORD);
    await page.getByRole('button', { name: 'Ask for an export' }).click();
    await expect(page.getByRole('alert')).toContainText('one export a day');
  });

  test('deleting an account takes the person out, and their old login stops working', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.request.post('/api/v1/homes/me/template', { data: { template: 'blank' }, headers: h });
    await page.goto('/settings/data');
    page.once('dialog', (d) => void d.accept());
    await page.getByLabel('Type your handle to confirm').fill('not-my-handle');
    await page.getByLabel('Your password').last().fill(PASSWORD);
    await page.getByRole('button', { name: 'Delete my account for good' }).click();
    await expect(page.getByRole('alert')).toContainText('Type your handle exactly');

    page.once('dialog', (d) => void d.accept());
    await page.getByLabel('Type your handle to confirm').fill(u.handle);
    await page.getByRole('button', { name: 'Delete my account for good' }).click();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible(); // back on the landing page
    await loginViaUi(page, u.handle, PASSWORD);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  for (const theme of ['modern', 'amber'] as const) {
    test(`accessibility of the data screen (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      const u = await makeUser(page);
      await signIn(page, u.handle, PASSWORD);
      await page.goto('/settings/data');
      await expect(page.getByRole('heading', { name: 'Export everything you made' })).toBeVisible();
      await scan(page, `settings/data (${theme})`);
    });
  }
});
