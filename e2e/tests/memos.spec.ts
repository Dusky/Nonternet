import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Memos (docs/22, M2): write, tag, pin, edit, delete with Undo, and the home box.
const h = { origin: BASE_URL };
const axe = async (page: import('@playwright/test').Page) => {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
};

test('write with Ctrl+Enter, find by tag and search, pin, edit and see "edited"', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.goto('/memos');
  await expect(page.getByText('No memos yet.')).toBeVisible();
  const box = page.getByLabel('Write a memo');
  await box.fill('Order lentils #shopping');
  await box.press('Control+Enter');
  await expect(page.getByText('Order lentils')).toBeVisible();
  await expect(box).toHaveValue('');
  await box.fill('Remember to call Sam #people');
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('Remember to call Sam')).toBeVisible();
  await expect(page.getByText('Private').first()).toBeVisible();

  await page.getByLabel('Tag', { exact: true }).selectOption('shopping');
  await expect(page.getByText('Order lentils')).toBeVisible();
  await expect(page.getByText('Remember to call Sam')).toHaveCount(0);
  await page.getByLabel('Tag', { exact: true }).selectOption('');
  await page.getByLabel('Search your memos').fill('sam');
  await expect(page.getByText('Remember to call Sam')).toBeVisible();
  await expect(page.getByText('Order lentils')).toHaveCount(0);
  await page.getByLabel('Search your memos').fill('');

  await page.getByRole('button', { name: /^Pin: Order lentils/ }).click();
  await expect(page.getByRole('button', { name: /^Unpin: Order lentils/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Edit: Remember to call Sam/ }).click();
  const edit = page.getByRole('form', { name: 'Edit memo' });
  await edit.getByLabel('Memo text').fill('Remember to call Sam on Friday #people');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Remember to call Sam on Friday')).toBeVisible();
  await expect(page.getByText(/edited/)).toBeVisible();
  await axe(page);
});

test('deleting a memo goes at once and Undo brings it back', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.request.post('/api/v1/memos', { data: { body: 'Keep this one' }, headers: h });
  await page.goto('/memos');
  await page.getByRole('button', { name: /^Delete: Keep this one/ }).click();
  await expect(page.getByText('Keep this one')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Keep this one')).toBeVisible();
  expect((await (await page.request.get('/api/v1/memos')).json()).total).toBe(1);
});

test('text with a dangerous link stays text, and the home box writes and lists', async ({ page }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.request.post('/api/v1/memos', { data: { body: 'Bad [click](javascript:alert(1)) and good https://example.org/ok' }, headers: h });
  await page.goto('/memos');
  await expect(page.getByRole('link', { name: 'https://example.org/ok' })).toHaveAttribute('rel', /noopener/);
  expect(await page.locator('.memo-body a[href^="javascript"]').count()).toBe(0);

  await page.goto('/');
  const panel = page.getByRole('region', { name: 'Memos' });
  await panel.getByLabel('Write a memo').fill('From the home screen');
  await panel.getByRole('button', { name: 'Post' }).click();
  await expect(panel.getByText('From the home screen')).toBeVisible();
  await axe(page);
});

test('share a memo publicly: it shows on the profile, others reply and react, the writer is told, and an admin can hide it', async ({ page, browser }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  await page.goto('/memos');
  await page.getByLabel('Write a memo').fill('A thought for everyone #share');
  await page.getByRole('radio', { name: 'Anyone' }).check();
  await expect(page.getByText('Shown on your profile and in your memos feed')).toBeVisible();
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('Public', { exact: true })).toBeVisible();

  // Someone else finds it on the profile, opens it, replies and reacts.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  const them = await makeUser(p2);
  await signIn(p2, them.handle, PASSWORD);
  await p2.goto(`/people/${me.handle}`);
  const section = p2.getByRole('region', { name: 'Memos' });
  await expect(section.getByText('A thought for everyone')).toBeVisible();
  await expect(section.getByRole('link', { name: 'Feed' })).toHaveAttribute('href', `/feeds/people/${me.handle}/memos.atom`);
  await axe(p2);
  await section.getByRole('link', { name: 'Open' }).click();
  await p2.getByLabel('Write a reply').fill('Well said');
  await p2.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(p2.getByText('Well said')).toBeVisible();
  await p2.getByRole('button', { name: 'React' }).first().click();
  await p2.getByRole('button', { name: 'Love' }).click();
  await expect(p2.getByRole('button', { name: /^Love/ })).toHaveAttribute('aria-pressed', 'true');
  await axe(p2);

  // The writer is told, and the Memos icon says so.
  await page.goto('/notifications');
  await expect(page.getByText(/replied to your memo/)).toBeVisible();
  await expect(page.getByText(/reacted to your memo/)).toBeVisible();

  // Someone reports it; an admin hides it from the queue and it leaves the profile.
  await p2.goto(`/people/${me.handle}`);
  await p2.getByRole('region', { name: 'Memos' }).getByRole('button', { name: /^Report:/ }).click();
  await p2.getByRole('form', { name: 'Report this memo' }).getByRole('button', { name: 'Send report' }).click();
  await expect(p2.getByText('Thanks. The moderators will look at it.')).toBeVisible();
  await other.close();
  const adminCtx = await browser.newContext();
  const ap = await adminCtx.newPage();
  const admin = await makeUser(ap);
  await setRole(admin.handle, 'admin');
  await signIn(ap, admin.handle, PASSWORD);
  await ap.goto('/boards/reports');
  const item = ap.getByRole('listitem').filter({ hasText: `About a memo by ${me.handle}` });
  await item.getByRole('button', { name: 'Hide', exact: true }).click();
  await item.getByLabel('Reason').fill('advertising');
  await item.getByRole('form', { name: 'Hide' }).getByRole('button', { name: 'Confirm' }).click();
  await expect(ap.getByText(`About a memo by ${me.handle}`)).toHaveCount(0);
  await adminCtx.close();
  expect((await (await page.request.get(`/api/v1/memos/public/${me.handle}`)).json()).memos).toEqual([]);
  await page.goto('/memos');
  await expect(page.getByText('Hidden by a moderator: advertising.')).toBeVisible();
});

test('a ring memo is for the ring\'s members only', async ({ page, browser }) => {
  const me = await makeUser(page);
  await setRole(me.handle, 'trusted');
  await signIn(page, me.handle, PASSWORD);
  const slug = uniq('notes').toLowerCase().slice(0, 20);
  expect((await page.request.post('/api/v1/rings', { data: { slug, name: 'Note takers' }, headers: h })).status()).toBe(201);
  await page.goto('/memos');
  await page.getByLabel('Write a memo').fill('For the ring only');
  await page.getByRole('radio', { name: 'Members of one of my rings' }).check();
  await page.getByLabel('Ring', { exact: true }).selectOption(slug);
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('In Note takers')).toBeVisible();
  await page.goto(`/rings/${slug}`);
  await expect(page.getByRole('region', { name: 'Shared memos' }).getByText('For the ring only')).toBeVisible();

  const other = await browser.newContext();
  const p2 = await other.newPage();
  const them = await makeUser(p2);
  await signIn(p2, them.handle, PASSWORD);
  await p2.goto(`/rings/${slug}`);
  await expect(p2.getByText('For the ring only')).toHaveCount(0);
  await p2.request.post(`/api/v1/rings/${slug}/join`, { headers: h });
  await p2.reload();
  await expect(p2.getByRole('region', { name: 'Shared memos' }).getByText('For the ring only')).toBeVisible();
  await other.close();
});
