import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';
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
  await edit.getByLabel('Write a memo').fill('Remember to call Sam on Friday #people');
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
