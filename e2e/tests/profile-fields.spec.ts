import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Profiles (docs/23, E5): the optional fields, the links, and recent activity.
const h = { origin: BASE_URL };

test('pronouns, location and links show on the profile, and a dangerous link is refused', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.goto('/settings/profile');
  await page.getByLabel('Pronouns').fill('she/her');
  await page.getByLabel('Where you are').fill('Somewhere windy');
  await page.getByLabel('Link 1 name').fill('My blog');
  await page.getByLabel('Link 1 address').fill('https://example.org/blog');
  await page.getByRole('button', { name: 'Save these' }).click();
  await page.goto(`/people/${me.handle}`);
  await expect(page.getByText('she/her · Somewhere windy')).toBeVisible();
  const link = page.getByRole('link', { name: 'My blog' });
  await expect(link).toHaveAttribute('href', 'https://example.org/blog');
  await expect(link).toHaveAttribute('rel', /noopener/);
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  expect((await page.request.patch('/api/v1/me', { data: { links: [{ label: 'x', url: 'javascript:alert(1)' }] }, headers: h })).status()).toBe(400);
});

test('a public post shows under recent activity', async ({ page }) => {
  const me = await makeUser(page);
  await setRole(me.handle, 'trusted');
  await signIn(page, me.handle, PASSWORD);
  const slug = uniq('act');
  await page.request.post('/api/v1/boards', { data: { slug, name: 'Activity', visibility: 'public' }, headers: h });
  const subject = uniq('Hello ');
  await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject, body: 'hi' }, headers: h });
  await page.goto(`/people/${me.handle}`);
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(page.getByRole('link', { name: subject })).toBeVisible();
});
