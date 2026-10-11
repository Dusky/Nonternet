import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
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

test('a public bookmark shows on the profile, can be reported, and an admin hides it from the queue', async ({ page, browser }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.request.post('/api/v1/bookmarks', { data: { url: 'https://nowhere.invalid/shared', title: 'Shared find', description: 'Worth a look', visibility: 'private' }, headers: h });
  await page.goto('/bookmarks');
  await page.getByRole('button', { name: 'Edit: Shared find' }).click();
  await page.getByRole('radio', { name: 'Anyone' }).check();
  await expect(page.getByText('Shown on your profile and in your bookmarks feed')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Public', { exact: true })).toBeVisible();

  // Someone else sees it on the profile, with a feed, and reports it.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  const them = await makeUser(p2);
  await signIn(p2, them.handle, PASSWORD);
  await p2.goto(`/people/${me.handle}`);
  const section = p2.getByRole('region', { name: 'Bookmarks' });
  await expect(section.getByRole('link', { name: 'Shared find' })).toHaveAttribute('href', 'https://nowhere.invalid/shared');
  await expect(section.getByRole('link', { name: 'Feed' })).toHaveAttribute('href', `/feeds/people/${me.handle}/bookmarks.atom`);
  await axe(p2);
  await section.getByRole('button', { name: 'Report: Shared find' }).click();
  await p2.getByRole('form', { name: 'Report “Shared find”' }).getByRole('button', { name: 'Send report' }).click();
  await expect(p2.getByText('Thanks. The moderators will look at it.')).toBeVisible();
  await other.close();

  // An admin hides it from the report queue; it leaves the profile and the owner sees why.
  const adminCtx = await browser.newContext();
  const ap = await adminCtx.newPage();
  const admin = await makeUser(ap);
  await setRole(admin.handle, 'admin');
  await signIn(ap, admin.handle, PASSWORD);
  await ap.goto('/boards/reports');
  const item = ap.getByRole('listitem').filter({ hasText: `About a bookmark shared by ${me.handle}` });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Hide', exact: true }).click();
  await item.getByLabel('Reason').fill('advertising');
  await item.getByRole('form', { name: 'Hide' }).getByRole('button', { name: 'Confirm' }).click();
  await expect(ap.getByText(`About a bookmark shared by ${me.handle}`)).toHaveCount(0); // actioned: off the open queue
  await adminCtx.close();
  expect((await (await page.request.get(`/api/v1/bookmarks/public/${me.handle}`)).json()).bookmarks).toEqual([]);
  await page.reload();
  await expect(page.getByText('Hidden by a moderator: advertising.')).toBeVisible();
});

test('sharing into a ring shows the link on the ring page', async ({ page }) => {
  const me = await makeUser(page);
  await setRole(me.handle, 'trusted');
  await signIn(page, me.handle, PASSWORD);
  const slug = uniq('links').toLowerCase().slice(0, 20);
  expect((await page.request.post('/api/v1/rings', { data: { slug, name: 'Link swappers' }, headers: h })).status()).toBe(201);
  await page.goto(`/bookmarks/add?url=${encodeURIComponent('https://nowhere.invalid/ringed')}&title=${encodeURIComponent('Ring find')}`);
  await page.getByRole('radio', { name: 'People who visit one of my rings' }).check();
  await page.getByLabel('Ring', { exact: true }).selectOption(slug);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved “Ring find”.' })).toBeVisible();
  await page.goto(`/rings/${slug}`);
  await expect(page.getByRole('region', { name: 'Shared links' }).getByRole('link', { name: 'Ring find' })).toBeVisible();
  await axe(page);
});
