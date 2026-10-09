import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Boards depth (docs/23, E3a): board rules, sorting and filtering threads, and following a thread.
const h = { origin: BASE_URL };

test('rules show, threads sort and filter, and following a thread brings its replies', async ({ page, browser }) => {
  const owner = await makeUser(page);
  const reader = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  await signIn(page, owner.handle, PASSWORD);
  const slug = uniq('depth');
  await page.request.post('/api/v1/boards', { data: { slug, name: 'Depth', visibility: 'public' }, headers: h });
  expect((await page.request.patch(`/api/v1/boards/${slug}`, { data: { rules: 'Be kind.\nNo spam.' }, headers: h })).ok()).toBe(true);
  const lonely = await (await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Lonely thread', body: 'hello' }, headers: h })).json();
  const chatty = await (await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Chatty thread', body: 'hello' }, headers: h })).json();
  await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'first reply', reply_to: chatty.id }, headers: h });
  await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'second reply', reply_to: chatty.id }, headers: h });

  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const rp = await ctx.newPage();
  await signIn(rp, reader.handle, PASSWORD);
  await rp.goto(`/boards/${slug}`);
  await rp.getByText('Board rules').click();
  await expect(rp.getByText('No spam.')).toBeVisible();

  // Newest first puts the later thread on top; the filter leaves only the one with no replies.
  await rp.getByLabel('Sort by').selectOption('replies');
  await expect(rp.locator('.thread-link').first()).toHaveText('Chatty thread');
  await rp.getByLabel('Show').selectOption('unanswered');
  await expect(rp.locator('.thread-link')).toHaveText(['Lonely thread']);
  const r = await new AxeBuilder({ page: rp }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // Following the lonely thread: a reply to it reaches the reader.
  await rp.locator('.thread-link', { hasText: 'Lonely thread' }).click();
  await rp.getByRole('button', { name: 'Follow thread' }).click();
  await expect(rp.getByRole('button', { name: 'Unfollow' })).toBeVisible();
  await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'anyone there?', reply_to: lonely.id }, headers: h });
  await rp.goto('/notifications');
  await expect(rp.getByRole('link', { name: new RegExp(`${owner.handle}.*Lonely thread`) }).first()).toBeVisible();
  await ctx.close();
});
