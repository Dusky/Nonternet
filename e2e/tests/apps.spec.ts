import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, totp } from '../support/helpers';
import { storedZip } from '../support/zip';

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
  // Adding asks first what it may do, everything it asks for ticked.
  const consent = page.getByRole('group', { name: 'What Todo may do' });
  await expect(consent.getByRole('checkbox', { name: 'Keeps its own things on your account. They are in your export.' })).toBeChecked();
  await scan(page, 'Add apps, asking what Todo may do');
  await consent.getByRole('button', { name: 'Add Todo' }).click();
  await expect(page.getByText('Todo added.')).toBeVisible();
  await page.getByRole('link', { name: 'Open Todo' }).click();
  if (!isMobile) await expect(page.getByRole('dialog', { name: 'Todo window' })).toBeVisible();
  else await expect(page).toHaveURL(/\/apps\/todo/);

  // The frame is sandboxed with no same-origin access.
  const frame = page.locator('iframe[title="Todo"]');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  expect(await frame.getAttribute('src')).toMatch(/^http:\/\/e2e-homes\.test:\d+\/apps\/todo@\d+\.\d+\.\d+\/index\.html#host=/);

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
  await page.getByRole('group', { name: 'What Todo may do' }).getByRole('button', { name: 'Add Todo' }).click();
  await expect(page.getByRole('button', { name: 'Remove Todo' })).toBeVisible();
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

test('an app added without keeping things can be allowed later in Settings', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/add-apps');
  await page.getByRole('button', { name: 'Add Todo' }).click();
  const consent = page.getByRole('group', { name: 'What Todo may do' });
  await consent.getByRole('checkbox', { name: /Keeps its own things/ }).uncheck();
  await consent.getByRole('button', { name: 'Add Todo' }).click();
  await expect(page.getByRole('button', { name: 'Remove Todo' })).toBeVisible();
  const granted = async () => (await (await page.request.get('/api/v1/me/apps')).json()).apps.find((a: { id: string }) => a.id === 'todo').granted as string[];
  expect(await granted()).not.toContain('storage');
  await page.goto('/settings/data');
  const sw = page.getByRole('group', { name: 'Todo' }).getByRole('switch', { name: /Keeps its own things/ });
  await expect(sw).not.toBeChecked();
  await scan(page, 'Settings with the apps you added');
  await sw.check();
  await expect(sw).toBeChecked();
  await expect.poll(granted).toContain('storage');
});

test('on a page the frame fits the app, and an app that does not start can be tried again', async ({ page, isMobile }) => {
  test.setTimeout(90_000);
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/add-apps');
  await page.getByRole('button', { name: 'Add Todo' }).click();
  await page.getByRole('group', { name: 'What Todo may do' }).getByRole('button', { name: 'Add Todo' }).click();
  await expect(page.getByRole('button', { name: 'Remove Todo' })).toBeVisible();
  // The frame takes the app's height (an empty list is short), within bounds, not a fixed 60% of the screen.
  await page.goto('/apps/todo');
  await expect(todo(page).getByPlaceholder(/Add a task/)).toBeVisible();
  const frame = page.locator('iframe[title="Todo"]');
  const vh = page.viewportSize()!.height;
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeLessThan(vh * 0.55);
  expect((await frame.boundingBox())!.height).toBeGreaterThanOrEqual(14 * 16 - 1);
  if (!isMobile) expect((await frame.boundingBox())!.width).toBeLessThanOrEqual(56 * 16 + 1);

  // A frame that never answers: "Starting…", then a plain failure with Try again, which works once it can load.
  await page.context().route(/\/apps\/todo@/, (r) => r.abort());
  await page.reload();
  await expect(page.getByText('Starting Todo…')).toBeVisible();
  await expect(page.getByText('Todo did not start.')).toBeVisible({ timeout: 25_000 });
  await page.context().unroute(/\/apps\/todo@/);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(todo(page).getByPlaceholder(/Add a task/)).toBeVisible();
  await expect(page.getByText('Todo did not start.')).toHaveCount(0);
});

test('an added app can put a widget on the home panel: Todo shows its open tasks and ticks them off', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  const origin = { origin: new URL(page.url()).origin };
  await page.request.put('/api/v1/me/apps/todo', { data: {}, headers: origin });
  await page.request.put('/api/v1/me/apps/todo/data/items/t1', { data: { data: { text: 'Water the plants', done: false, created_at: '2026-10-18T10:00:00Z' } }, headers: origin });
  await page.goto('/');
  await page.getByRole('button', { name: 'Change the home panel' }).click();
  await page.getByRole('button', { name: 'Add Todo' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const widget = page.frameLocator('iframe[title="Todo (widget)"]');
  await expect(widget.getByText('Water the plants')).toBeVisible();
  await scan(page, 'the home panel with an app widget');
  await widget.getByRole('checkbox', { name: 'Water the plants' }).click(); // ticked tasks leave the widget at once
  await expect(widget.getByText('Nothing to do.')).toBeVisible();
  await expect.poll(async () => (await (await page.request.get('/api/v1/me/apps/todo/data/items')).json()).docs[0].data.done).toBe(true);
});

// An app made from Todo's built files under another id, as a trusted person would send it (docs/10).
function choresZip(version: string): Buffer {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../packs/build/todo');
  const files: Record<string, Buffer> = {};
  const walk = (rel: string) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p); else files[p] = readFileSync(join(dir, p));
    }
  };
  walk('');
  const m = JSON.parse(files['manifest.json']!.toString());
  files['manifest.json'] = Buffer.from(JSON.stringify({ ...m, id: `chores${RUN}`, name: `Chores ${RUN}`, version, description: 'Chores for the house.' }));
  return storedZip(files);
}
const RUN = Date.now().toString(36).slice(-5);

test('a trusted person sends an app, tries it alone, an admin reviews and offers it, and others see who made it', async ({ page, browser, isMobile }) => {
  test.skip(isMobile, 'one browser is enough: the flow is the same on a phone');
  const maker = await makeUser(page);
  await setRole(maker.handle, 'trusted');
  await signIn(page, maker.handle, PASSWORD);
  await page.goto('/settings/apps-made');
  await page.getByLabel('Send an app (a .zip)').setInputFiles({ name: 'chores.zip', mimeType: 'application/zip', buffer: choresZip('1.0.0') });
  const card = page.locator('.made-apps li.panel', { hasText: `Chores ${RUN}` });
  await expect(card).toContainText('waiting for review');
  await expect(card).toContainText('Not offered yet.');
  await scan(page, 'Settings: apps you made');
  await card.getByRole('button', { name: `Try Chores ${RUN}` }).click();
  const app = page.frameLocator(`iframe[title="Chores ${RUN}"]`);
  await app.getByLabel('New task').fill('Water the plants');
  await app.getByLabel('New task').press('Enter');
  await expect(app.getByText('Water the plants')).toBeVisible();

  // Nobody else has it yet.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const other = await makeUser(p);
  await signIn(p, other.handle, PASSWORD);
  await p.goto('/add-apps');
  await expect(p.getByRole('button', { name: 'Add Todo' })).toBeVisible();
  await expect(p.getByRole('heading', { name: `Chores ${RUN}` })).toHaveCount(0);

  // An admin looks at it, tries it in the sandbox and offers it.
  const actx = await browser.newContext();
  const ap = await actx.newPage();
  const admin = await makeAdmin(ap, { withTotp: false });
  await signIn(ap, admin.handle, PASSWORD);
  await ap.goto('/admin/apps');
  const review = ap.locator('.app-review', { hasText: `Chores ${RUN}` });
  await expect(review).toContainText(`Made by ${maker.handle}.`);
  await expect(review).toContainText('First version');
  await review.getByRole('button', { name: `Try Chores ${RUN} here` }).click();
  await expect(ap.frameLocator(`iframe[title="Chores ${RUN}"]`).getByLabel('New task')).toBeVisible();
  await scan(ap, 'the review queue');
  await review.getByRole('button', { name: `Approve and offer Chores ${RUN}` }).click();
  await expect(ap.getByText(`Chores ${RUN} is offered now.`)).toBeVisible();

  await p.goto('/add-apps');
  const listed = p.locator('.app-card', { hasText: `Chores ${RUN}` });
  await expect(listed).toContainText(`Made by ${maker.handle}.`);
  await listed.getByRole('button', { name: `Report Chores ${RUN}` }).click();
  await listed.getByRole('button', { name: 'Send report' }).click();
  await expect(listed.getByText('Thanks. The admins will look at it.')).toBeVisible();

  // The author takes it back; it leaves Add apps for everyone.
  await page.goto('/settings/apps-made');
  await expect(card).toContainText('Offered to everyone at version 1.0.0.');
  await card.getByRole('button', { name: `Take back Chores ${RUN}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Take it back' }).click();
  await expect(page.getByText(`Chores ${RUN} was taken back.`)).toBeVisible();
  await p.goto('/add-apps');
  await expect(p.getByRole('button', { name: 'Add Todo' })).toBeVisible();
  await expect(p.getByRole('heading', { name: `Chores ${RUN}` })).toHaveCount(0);
  await ctx.close();
  await actx.close();
});
