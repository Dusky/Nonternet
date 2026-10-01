import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Writing and reading (M9-C): drafts, @mentions, editing with history, reactions, pins.
const h = { origin: BASE_URL };

async function board(page: import('@playwright/test').Page, owner: { handle: string }) {
  await setRole(owner.handle, 'trusted');
  const api = page.context().request;
  await api.post('/api/v1/auth/login', { data: { identifier: owner.handle, password: PASSWORD }, headers: h });
  const slug = uniq('wr');
  await api.post('/api/v1/boards', { data: { slug, name: 'Writing', visibility: 'public' }, headers: h });
  const t = await (await api.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'First thread', body: 'Opening words.' }, headers: h })).json();
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  return { slug, thread: t.id as string };
}

test('a half-written reply survives a reload, and can be discarded', async ({ page }) => {
  const u = await makeUser(page);
  const { slug, thread } = await board(page, u);
  await signIn(page, u.handle, PASSWORD);
  await page.goto(`/boards/${slug}/t/${thread}`);
  const box = page.getByLabel('Message');
  await box.fill('Not finished yet');
  await expect(page.getByText(/\d+ left/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Message')).toHaveValue('Not finished yet');
  await expect(page.getByText('Draft restored.')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByLabel('Message')).toHaveValue('');
});

test('@ suggests people, Ctrl+Enter posts', async ({ page }) => {
  const u = await makeUser(page);
  const friend = await makeUser(page, { handle: uniq('zed') });
  const { slug, thread } = await board(page, u);
  await signIn(page, u.handle, PASSWORD);
  await page.goto(`/boards/${slug}/t/${thread}`);
  const box = page.getByLabel('Message');
  await box.fill(`hi @${friend.handle.slice(0, 4)}`);
  await page.getByRole('option', { name: new RegExp(friend.handle) }).click();
  await expect(box).toHaveValue(`hi @${friend.handle} `);
  await box.press('Control+Enter');
  await expect(page.getByText(`hi @${friend.handle}`).first()).toBeVisible();
  await expect(box).toHaveValue('');
});

test('editing keeps the old text, reactions toggle, ops can pin', async ({ page }) => {
  const u = await makeUser(page);
  const { slug, thread } = await board(page, u);
  await signIn(page, u.handle, PASSWORD);
  await page.goto(`/boards/${slug}/t/${thread}`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Message').first().fill('Opening words, corrected.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Opening words, corrected.')).toBeVisible();
  await page.getByRole('button', { name: /^edited/ }).click();
  await expect(page.getByRole('region', { name: 'Earlier versions' })).toBeVisible();
  await page.getByText(/ago|just now|now/).last().click().catch(() => undefined);

  await page.getByRole('button', { name: 'React' }).click();
  await page.getByRole('button', { name: 'Thanks' }).click();
  const thanks = page.getByRole('button', { name: /^Thanks 1/ });
  await expect(thanks).toHaveAttribute('aria-pressed', 'true');
  await thanks.click();
  await expect(page.getByRole('button', { name: /^Thanks/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Pin to top' }).click();
  await expect(page.getByText('Pinned').first()).toBeVisible();
  await page.getByRole('button', { name: 'Unpin' }).click();
  await expect(page.getByRole('button', { name: 'Pin to top' })).toBeVisible();
});

test('search keeps its words in the address, and a person card shows on hover', async ({ page, isMobile }) => {
  const u = await makeUser(page);
  const { slug, thread } = await board(page, u);
  const word = uniq('zork').replace(/[^a-z]/g, 'q');
  const api = page.context().request;
  await api.post('/api/v1/auth/login', { data: { identifier: u.handle, password: PASSWORD }, headers: h });
  await api.post(`/api/v1/boards/${slug}/posts`, { data: { subject: `Findable ${word}`, body: `All about ${word}.` }, headers: h });
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/boards/search');
  await page.getByLabel('Search for').fill(word);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/boards/search/${word}$`));
  await expect(page.getByRole('link', { name: `Findable ${word}` })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Search for')).toHaveValue(word);
  await expect(page.getByRole('link', { name: `Findable ${word}` })).toBeVisible();

  test.skip(isMobile, 'hover cards are for a pointer');
  await page.goto(`/boards/${slug}/t/${thread}`);
  const who = page.getByRole('link', { name: new RegExp(u.handle) }).first();
  await who.hover();
  await expect(page.getByRole('group', { name: /^About / })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: /^About / })).toHaveCount(0);
});
