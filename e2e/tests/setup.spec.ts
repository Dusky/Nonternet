import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser } from '../support/helpers';

// The installer's web finish (docs/19). Making the first admin is covered by core's tests (setup.test.ts): this test stack
// already has an admin, so here the page must say plainly that the site is set up, and refuse the form's request.
test('the setup page is closed once a site has an admin', async ({ page }) => {
  await makeUser(page); // makes the seed admin on a fresh database too
  await page.goto('/setup?token=anything');
  await expect(page.getByRole('heading', { name: 'This site is set up' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  const res = await page.request.post('/api/v1/setup', { data: { token: 'anything', handle: 'sneaky', email: 'x@example.test', password: 'a long password here' }, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(410);
});
