import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Light, dark, or follow the device (docs/10), for every theme that has both.
const h = { origin: BASE_URL };
const axe = async (page: import('@playwright/test').Page, where: string) => {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => `${where} ${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
};
const bodyBackground = (page: import('@playwright/test').Page) =>
  page.evaluate(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number); return (r! + g! + b!) / 3; });

test('choose Dark in Settings: the whole site goes dark, it is kept on reload, and Light brings it back', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.goto('/settings/appearance');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  expect(await bodyBackground(page)).toBeGreaterThan(150);
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  expect(await bodyBackground(page)).toBeLessThan(80);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Light', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
});

test('Follow my device changes with the device, live', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/settings/appearance');
  await expect(page.getByRole('radio', { name: 'Follow my device' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
});

test('After dark and Terminal are always dark, and say so', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.request.patch('/api/v1/me', { data: { theme: 'after-dark' }, headers: h });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings/appearance');
  await expect(page.getByText('After dark is always dark. The other themes follow this choice.')).toBeVisible();
  expect(await bodyBackground(page)).toBeLessThan(80);
});

for (const theme of ['webring', 'platinum', 'aqua']) {
  test(`${theme} in dark has readable text and visible controls on the main screens`, async ({ page }) => {
    const me = await makeUser(page);
    await signIn(page, me.handle, PASSWORD);
    await page.request.patch('/api/v1/me', { data: { theme }, headers: h });
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const path of ['/', '/boards', '/memos', '/bookmarks', '/settings/appearance']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await bodyBackground(page), `${theme} ${path}`).toBeLessThan(110);
      await axe(page, `${theme} ${path}`);
    }
  });
}
