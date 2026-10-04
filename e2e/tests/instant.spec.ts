import type { Page, Route } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// The instant feel (docs/10): frequent actions change the screen at once and the server catches up behind them.
// Each test slows the server down on purpose and checks the screen changes long before the answer arrives, and
// that a refusal puts things back.
const h = { origin: BASE_URL };
const SLOW = 2500;
const QUICK = 600; // what "at once" has to beat here, generously, on a busy test machine

async function slow(page: Page, match: (r: Route) => boolean, opts: { fail?: boolean } = {}) {
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().method() === 'GET' || !match(route)) return route.continue();
    await new Promise((r) => setTimeout(r, SLOW));
    if (opts.fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'The site is busy. Try again in a moment.' } }) });
    return route.continue();
  });
}

test('a mail reply shows at once as sending, and comes back to the box if it is refused', async ({ page, browser }) => {
  const a = await makeUser(page);
  const ctx = await browser.newContext();
  const bp = await ctx.newPage();
  const b = await makeUser(bp);
  await signIn(page, a.handle, PASSWORD);
  const sent = await page.request.post('/api/v1/mail', { data: { to: [b.handle], subject: 'Lunch?', body: 'Noon at the usual place?' }, headers: h });
  const id = (await sent.json()).id as string;
  await signIn(bp, b.handle, PASSWORD);
  await bp.goto(`/mail/${id}`);
  await expect(bp.getByText('Noon at the usual place?')).toBeVisible();

  await slow(bp, (r) => r.request().url().includes(`/mail/${id}/messages`));
  await bp.getByLabel('Reply').fill('Sounds good.');
  const t0 = Date.now();
  await bp.getByRole('button', { name: 'Send reply' }).click();
  await expect(bp.getByText('Sounds good.')).toBeVisible({ timeout: QUICK });
  expect(Date.now() - t0).toBeLessThan(QUICK);
  await expect(bp.getByText('Sending…')).toBeVisible();
  await expect(bp.getByText('Sending…')).toHaveCount(0, { timeout: SLOW + 5000 }); // the server's copy replaces it
  await expect(bp.getByText('Sounds good.')).toBeVisible();

  // Refused: the message disappears, the text goes back in the box, and the reason is shown.
  await bp.unroute('**/api/v1/**');
  await slow(bp, (r) => r.request().url().includes(`/mail/${id}/messages`), { fail: true });
  await bp.getByLabel('Reply').fill('See you there.');
  await bp.getByRole('button', { name: 'Send reply' }).click();
  await expect(bp.getByText('See you there.')).toBeVisible({ timeout: QUICK });
  await expect(bp.getByRole('alert')).toContainText('The site is busy', { timeout: SLOW + 5000 });
  await expect(bp.getByLabel('Reply')).toHaveValue('See you there.');
  await ctx.close();
});

test('watching a board, reacting and marking notifications read change at once', async ({ page }) => {
  const u = await makeUser(page);
  await setRole(u.handle, 'trusted');
  await signIn(page, u.handle, PASSWORD);
  const slug = uniq('fast');
  expect((await page.request.post('/api/v1/boards', { data: { slug, name: 'Fast', visibility: 'public' }, headers: h })).ok()).toBe(true);
  const post = await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Quick one', body: 'Hello there' }, headers: h });
  const thread = (await post.json()).thread_id ?? (await post.json()).id;

  await page.goto(`/boards/${slug}`);
  await slow(page, (r) => r.request().url().includes(`/boards/${slug}/watch`));
  const watch = page.getByRole('button', { name: /^(Watch|Stop watching)$/ });
  const was = await watch.getAttribute('aria-pressed');
  const t0 = Date.now();
  await watch.click();
  await expect(watch).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true', { timeout: QUICK });
  expect(Date.now() - t0).toBeLessThan(QUICK);
  await page.unroute('**/api/v1/**');

  await page.goto(`/boards/${slug}/t/${thread}`);
  await slow(page, (r) => r.request().url().includes('/reactions/'));
  await page.getByRole('button', { name: 'React' }).first().click();
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Thanks' }).first().click();
  await expect(page.getByRole('button', { name: 'Thanks 1' })).toHaveAttribute('aria-pressed', 'true', { timeout: QUICK });
  expect(Date.now() - t1).toBeLessThan(QUICK);
  await page.unroute('**/api/v1/**');
  // And it stuck.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Thanks 1' })).toHaveAttribute('aria-pressed', 'true');
});

test('hovering a thread link starts loading it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'there is no hover on a phone; focus is covered by the same code');
  const u = await makeUser(page);
  await setRole(u.handle, 'trusted');
  await signIn(page, u.handle, PASSWORD);
  const slug = uniq('warm');
  await page.request.post('/api/v1/boards', { data: { slug, name: 'Warm', visibility: 'public' }, headers: h });
  await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Hover me', body: 'Loaded early' }, headers: h });
  await page.goto(`/boards/${slug}`);
  const loaded = page.waitForRequest((r) => r.method() === 'GET' && /\/api\/v1\/boards\/[^/]+\/threads\/[^/?]+/.test(r.url()));
  await page.getByRole('link', { name: 'Hover me' }).hover();
  await loaded;
});
