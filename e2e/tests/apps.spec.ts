import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeAdmin, makeUser, PASSWORD, signIn, totp } from '../support/helpers';

// Installable apps (docs/10, docs/15): add Todo from "Add apps", use it, find it again after a reload, remove it
// (its list stays), add it back, and an admin can withdraw it. Todo runs in a sandboxed frame on the homes origin
// and reaches the account only through the shell's bridge.

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}
const todo = (page: Page) => page.frameLocator('iframe[title="Todo"]');

test('add Todo, keep a list in it, remove it and add it back with the list still there', async ({ page, isMobile }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/add-apps');
  await expect(page.getByRole('heading', { name: 'Todo' })).toBeVisible();
  await expect(page.getByText('Keeps its own things on your account. They are in your export.')).toBeVisible();
  await scan(page, 'Add apps');
  await page.getByRole('button', { name: 'Add Todo' }).click();
  await expect(page.getByText('Todo added.')).toBeVisible();
  await page.getByRole('link', { name: 'Open Todo' }).click();
  if (!isMobile) await expect(page.getByRole('dialog', { name: 'Todo window' })).toBeVisible();
  else await expect(page).toHaveURL(/\/apps\/todo/);

  // The frame is sandboxed with no same-origin access.
  const frame = page.locator('iframe[title="Todo"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  expect(await frame.getAttribute('src')).toMatch(/^http:\/\/e2e-homes\.test:\d+\/apps\/todo@1\.0\.0\/index\.html#host=/);

  const box = todo(page).getByLabel('New task');
  await box.fill('Buy milk');
  await box.press('Enter');
  await box.fill('Call Sam');
  await box.press('Enter');
  await expect(todo(page).getByText('2 left')).toBeVisible();
  await todo(page).getByRole('checkbox', { name: 'Buy milk' }).check();
  await expect(todo(page).getByText('1 left')).toBeVisible();

  // Delete acts at once; the shell's note offers Undo.
  await todo(page).getByRole('button', { name: 'Delete “Call Sam”' }).click();
  await expect(todo(page).getByText('Call Sam')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(todo(page).getByText('Call Sam')).toBeVisible();

  // The theme comes across the bridge: the app's background is the shell's surface colour.
  const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim());
  await expect.poll(() => todo(page).locator('body').evaluate((b) => getComputedStyle(b).getPropertyValue('--surface').trim())).toBe(surface);

  // After a reload the list is still there (it is on the account, not in the frame).
  await page.goto('/apps/todo');
  await expect(todo(page).getByRole('checkbox', { name: 'Buy milk' })).toBeChecked();
  await expect(todo(page).getByText('Call Sam')).toBeVisible();
  await scan(page, 'Todo on its own page');

  // Removing takes it off the desktop and keeps the list; adding it back brings the list back.
  await page.goto('/add-apps');
  await page.getByRole('button', { name: 'Remove Todo' }).click();
  await expect(page.getByRole('button', { name: 'Add Todo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete what Todo kept' })).toBeVisible();
  if (!isMobile) {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open Todo' })).toHaveCount(0);
    await page.goto('/add-apps');
  }
  await page.getByRole('button', { name: 'Add Todo' }).click();
  await page.goto('/apps/todo');
  await expect(todo(page).getByText('Call Sam')).toBeVisible();
  if (!isMobile) {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open Todo' })).toBeVisible();
  }
});

test('the app frame cannot reach the network, and forged messages to the shell get nothing', async ({ page, pageErrors }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.request.put('/api/v1/me/apps/todo', { data: {}, headers: { origin: new URL(page.url()).origin } });
  await page.goto('/apps/todo');
  await expect(todo(page).getByLabel('New task')).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes('/apps/todo@'))!;
  // And the frame can't reach the network itself (connect-src 'none'), not even the site's API.
  const fetched = await frame.evaluate(async (api) => { try { await fetch(api); return 'reached'; } catch { return 'blocked'; } }, `${new URL(page.url()).origin}/api/v1/me`);
  expect(fetched).toBe('blocked');
  // The browser reports the blocked request; that report is what this test expects, so it isn't a page error.
  const blocked = pageErrors.filter((e) => /Content Security Policy|Failed to fetch/.test(e));
  expect(blocked.length).toBeGreaterThan(0);
  pageErrors.splice(0, pageErrors.length, ...pageErrors.filter((e) => !blocked.includes(e)));
  // A window that is not the frame posting to the shell gets no answer and changes nothing.
  const before = await page.request.get('/api/v1/me/apps/todo/data/items');
  await page.evaluate(() => window.postMessage({ namespace: 'penpal', type: 'CALL', methodName: 'storagePut', args: ['items', 'evil', { text: 'x' }] }, '*'));
  await page.waitForTimeout(300);
  expect((await (await page.request.get('/api/v1/me/apps/todo/data/items')).json()).docs.length).toBe((await before.json()).docs.length);
});

test('an admin withdraws Todo and it leaves Add apps; offering it again brings it back', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'the console flow is covered on the big screen');
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, PASSWORD, { totp: await totp(admin.secret, 1) });
  await page.goto('/admin/apps');
  const offer = page.getByLabel('Offer Todo');
  await expect(offer).toBeChecked();
  await scan(page, 'the console Apps page');

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const u = await makeUser(p);
  await signIn(p, u.handle, PASSWORD);
  try {
    await offer.uncheck();
    await expect(offer).not.toBeChecked();
    await p.goto('/add-apps');
    await expect(p.getByText('No apps are offered on this site yet.')).toBeVisible();
  } finally {
    // Other tests on this shared site use Todo too.
    await offer.check();
    await expect(offer).toBeChecked();
  }
  await p.goto('/add-apps');
  await expect(p.getByRole('button', { name: 'Add Todo' })).toBeVisible();
  await ctx.close();
});
