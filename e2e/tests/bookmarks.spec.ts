import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Bookmarks (docs/21, B2): save, tag, pin, find, remove with Undo, the home panel section, and the bookmarklet's form.
const h = { origin: BASE_URL };
const axe = async (page: import('@playwright/test').Page) => {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
};

test('save a link, tag and pin it, find it, and see it on the home screen', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.goto('/bookmarks');
  await expect(page.getByText('No bookmarks yet.')).toBeVisible();
  // .invalid never resolves, so the page can't be read: the link is saved anyway, named after its address.
  const path = uniq('garden');
  await page.getByLabel('Save a link').fill(`nowhere.invalid/${path}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const title = `nowhere.invalid/${path}`;
  await expect(page.getByRole('link', { name: title })).toHaveAttribute('href', `https://nowhere.invalid/${path}`);
  await expect(page.getByRole('link', { name: title })).toHaveAttribute('rel', /noopener/);

  await page.getByRole('button', { name: `Edit: ${title}` }).click();
  const form = page.getByRole('form', { name: `Edit “${title}”` });
  await form.getByLabel('Title').fill('Tomato notes');
  await form.getByLabel('Tags').fill('garden food');
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('link', { name: 'Tomato notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Pin: Tomato notes' }).click();
  await expect(page.getByRole('button', { name: 'Unpin: Tomato notes' })).toHaveAttribute('aria-pressed', 'true');

  // Another one, so filtering has something to leave out.
  await page.request.post('/api/v1/bookmarks', { data: { url: 'https://nowhere.invalid/other', title: 'Something else', description: '' }, headers: h });
  await page.reload();
  await page.getByLabel('Search your bookmarks').fill('tomato');
  await expect(page.getByRole('link', { name: 'Tomato notes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Something else' })).toHaveCount(0);
  await page.getByLabel('Search your bookmarks').fill('');
  await page.getByLabel('Tag', { exact: true }).selectOption('food');
  await expect(page.getByRole('link', { name: 'Something else' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Tomato notes' })).toBeVisible();
  await axe(page);

  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Bookmarks' });
  await expect(panel.getByRole('link', { name: 'Tomato notes' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Something else' })).toBeVisible();
});

test('removing a bookmark goes at once and Undo brings it back', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.request.post('/api/v1/bookmarks', { data: { url: 'https://nowhere.invalid/keep', title: 'Keep me', description: '' }, headers: h });
  await page.goto('/bookmarks');
  await page.getByRole('button', { name: 'Remove: Keep me' }).click();
  await expect(page.getByRole('link', { name: 'Keep me' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: 'Keep me' })).toBeVisible();
  expect((await (await page.request.get('/api/v1/bookmarks')).json()).total).toBe(1);
});

test('the bookmarklet\'s form is filled in but saves nothing until Save is pressed', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.goto('/bookmarks');
  await page.getByText('Save links from any page').click();
  await expect(page.getByRole('link', { name: 'Save to bookmarks' })).toHaveAttribute('href', /^javascript:/);

  const url = `https://nowhere.invalid/${uniq('recipe')}`;
  await page.goto(`/bookmarks/add?url=${encodeURIComponent(url)}&title=${encodeURIComponent('Lentil soup')}`);
  await expect(page.getByLabel('Address')).toHaveValue(url);
  await expect(page.getByLabel('Title')).toHaveValue('Lentil soup');
  expect((await (await page.request.get('/api/v1/bookmarks')).json()).total).toBe(0);
  await axe(page);
  await page.getByLabel('Tags').fill('food');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved “Lentil soup”.' })).toBeVisible();
  // Saving the same page again says so rather than making a second one.
  await page.goto(`/bookmarks/add?url=${encodeURIComponent(`${url}#part-2`)}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You already saved “Lentil soup”.' })).toBeVisible();
  expect((await (await page.request.get('/api/v1/bookmarks')).json()).total).toBe(1);
});

test('a signed-out visitor is sent to log in and comes back to the form', async ({ page }) => {
  const me = await makeUser(page);
  await page.goto(`/bookmarks/add?url=${encodeURIComponent('https://nowhere.invalid/later')}`);
  await expect(page).toHaveURL(/\/login\?return_to=/);
  await page.getByLabel('Handle or email').fill(me.handle);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByLabel('Address')).toHaveValue('https://nowhere.invalid/later');
});
