import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// The old-internet bundle (docs/05): a .plan written in Settings shows on the profile, public boards have an Atom feed,
// and the front page says how to reach the Gopher and Gemini mirrors and finger.
const h = { origin: BASE_URL };

test('a plan written in Settings shows on the profile, and a board\'s feed carries its new thread', async ({ page }) => {
  const u = await makeUser(page);
  await setRole(u.handle, 'trusted');
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/profile');
  await page.getByLabel('Plan').fill('Rebuilding the modem bank.\nBack on Tuesday.');
  await page.getByRole('button', { name: 'Update plan' }).click();
  await expect(page.getByRole('button', { name: 'Update plan' })).toBeDisabled(); // saved: nothing left to update
  await page.goto(`/people/${u.handle}`);
  await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
  await expect(page.getByText('Rebuilding the modem bank.')).toBeVisible();

  const slug = uniq('feed');
  expect((await page.request.post('/api/v1/boards', { data: { slug, name: 'Feed board', visibility: 'public' }, headers: h })).ok()).toBe(true);
  expect((await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Fresh from the feed', body: 'Hello readers' }, headers: h })).ok()).toBe(true);
  await page.goto(`/boards/${slug}`);
  const feed = page.getByRole('link', { name: 'Feed', exact: true });
  await expect(feed).toHaveAttribute('href', `/feeds/boards/${slug}.atom`);
  await expect(page.locator('head link[rel="alternate"][type="application/atom+xml"]')).toHaveAttribute('href', `/feeds/boards/${slug}.atom`);
  const atom = await page.request.get(`/feeds/boards/${slug}.atom`);
  expect(atom.headers()['content-type']).toContain('application/atom+xml');
  expect(await atom.text()).toContain('<title>Fresh from the feed</title>');
});

test('the front page says how to reach Gopher, Gemini and finger', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('gopher://')).toBeVisible();
  await expect(page.getByText('gemini://127.0.0.1/')).toBeVisible();
  await expect(page.getByText('finger handle@127.0.0.1 (port 7979)')).toBeVisible();
});
