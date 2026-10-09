import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Live updates (M9, docs/10): a change shows up in a tab that is already open, with no reload. The slow
// safety check is five minutes while the stream is up, so these pass within seconds only because of the push.
const h = { origin: BASE_URL };

async function signedInPage(browser: Browser, handle: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await signIn(page, handle, PASSWORD);
  return page;
}

test('a reply and a mail reach an open tab without a reload', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'the same stream serves phones; the desktop run covers it');
  const owner = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  const other = await makeUser(page);
  const slug = uniq('live');
  const op = await signedInPage(browser, owner.handle);
  await op.request.post('/api/v1/boards', { data: { slug, name: `Live ${slug}`, visibility: 'public' }, headers: h });
  const t = await (await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: `Live ${slug}`, body: 'Anyone there?' }, headers: h })).json();

  await op.goto('/');
  await expect(op.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible(); // nothing unread yet; the stream is open

  await signIn(page, other.handle, PASSWORD);
  await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: `Yes, hello @${owner.handle}`, reply_to: t.id }, headers: h });
  await expect(op.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible({ timeout: 8000 });

  await page.request.post('/api/v1/mail', { data: { to: [owner.handle], subject: 'Live mail', body: 'Hello.' }, headers: h });
  await expect(op.getByRole('button', { name: 'Mail, 1 unread', exact: true })).toBeVisible({ timeout: 8000 });
  await op.context().close();
});

test('an open thread shows a new reply as it arrives', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'covered on the desktop run');
  const owner = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  const other = await makeUser(page);
  const slug = uniq('thr');
  const op = await signedInPage(browser, owner.handle);
  await op.request.post('/api/v1/boards', { data: { slug, name: `Thread ${slug}`, visibility: 'public' }, headers: h });
  const t = await (await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: `Open ${slug}`, body: 'Read me.' }, headers: h })).json();
  await op.goto(`/boards/${slug}/t/${t.id}`);
  await expect(op.getByText('Read me.')).toBeVisible();

  await signIn(page, other.handle, PASSWORD);
  await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'A reply that arrives live.', reply_to: t.id }, headers: h });
  await expect(op.getByText('A reply that arrives live.')).toBeVisible({ timeout: 8000 });
  await op.context().close();
});

test('the stream refuses a visitor', async ({ page }) => {
  const res = await page.request.get('/api/v1/events');
  expect(res.status()).toBe(401);
});
