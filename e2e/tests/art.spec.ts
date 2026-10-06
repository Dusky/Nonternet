import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// The site's drawings (docs/10): made from shapes and words in the theme's colours, never pictures. Each one is
// decorative (hidden from screen readers, which hear only the words beside it), and nothing gets worse for it.
const scan = async (page: Page, what: string) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
};

test('the front page shows the site as a small desktop, and a missing page shows the lost window', async ({ page }) => {
  await page.goto('/');
  const scene = page.locator('.scene');
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute('aria-hidden', 'true');
  await expect(scene.locator('.scene-term pre')).toContainText('CONNECT');
  // The windows fade in as they open; colours are judged once they have.
  await page.waitForFunction(() => document.getAnimations().every((a) => (a as CSSAnimation).animationName !== 'pop-in' || a.playState === 'finished'));
  await scan(page, 'the front page');
  await page.goto('/nowhere/at/all');
  await expect(page.getByRole('heading', { name: 'That page does not exist.' })).toBeVisible();
  await expect(page.locator('.lost-stack')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.lost-path')).toHaveText('/nowhere/at/all');
  await scan(page, 'the not-found page');
  expect(await page.locator('img').count()).toBe(0);
});

test('empty places get a drawing, and the rings page its loop', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/mail');
  await expect(page.locator('.empty svg.spot-mail')).toBeVisible();
  await scan(page, 'an empty inbox');
  await page.goto('/rings');
  await expect(page.locator('svg.ring-orbit')).toBeVisible();
});

test('when the site cannot be reached, the error screen shows an unplugged drawing and a way to retry', async ({ page }) => {
  await page.route('**/api/v1/site', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('svg.spot-plug')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});
