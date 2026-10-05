import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// The site's pictures (docs/10): each one loads, is decorative (empty alt, so screen readers hear only the words next
// to it), and nothing about the page gets worse for having it.
const scan = async (page: Page, what: string) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
};
const loaded = (page: Page, sel: string) => page.locator(sel).first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);

test('the front page shows the hillside, and a missing page shows the lost dog', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('img.landing-art')).toHaveAttribute('alt', '');
  await expect.poll(() => loaded(page, 'img.landing-art')).toBe(true);
  await scan(page, 'the front page');
  await page.goto('/nowhere/at/all');
  await expect(page.getByRole('heading', { name: 'That page does not exist.' })).toBeVisible();
  await expect.poll(() => loaded(page, 'img.card-art')).toBe(true);
  await scan(page, 'the not-found page');
});

test('empty places get a small picture, and the wallpaper pictures are served', async ({ page, request }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/mail');
  await expect(page.locator('img.empty-art')).toBeVisible();
  await expect.poll(() => loaded(page, 'img.empty-art')).toBe(true);
  await scan(page, 'an empty inbox');
  for (const f of ['hillside', 'harbour', 'lanterns', 'lantern-hill', 'tower', 'paper-stars', 'slate-stars']) {
    const r = await request.get(`/wallpapers/${f}.webp`);
    expect(r.ok(), f).toBe(true);
    expect(r.headers()['content-type']).toContain('image/webp');
  }
});
