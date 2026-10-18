import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Locator, Page } from '@playwright/test';
import { makeUser, PASSWORD, signIn } from '../support/helpers';
import { BASE_URL } from '../support/stack';

const h = { origin: BASE_URL };

const cell = (page: Page, app: string) => page.locator(`li:has([data-app-icon="${app}"])`);
const place = async (l: Locator) => l.evaluate((el) => `${(el as HTMLElement).style.gridColumnStart}/${(el as HTMLElement).style.gridRowStart}`);

async function scan(page: Page, what: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}

test.describe('the desktop layout (big screens)', () => {
  test.skip(({ isMobile }) => isMobile, 'icons are arranged on the big-screen desktop');

  async function start(page: Page) {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await expect(page.getByRole('button', { name: 'Open Boards' })).toBeVisible();
    return u;
  }

  test('an icon dragged to another cell stays there after a reload, and a click still opens the app', async ({ page }) => {
    await start(page);
    const boards = page.locator('[data-app-icon="boards"]');
    const before = await place(cell(page, 'boards'));
    const b = (await boards.boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + 40);
    await page.mouse.down();
    await page.mouse.move(b.x + 40 + 2 * 104, b.y + 40 + 2 * 112, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => place(cell(page, 'boards'))).not.toBe(before);
    const moved = await place(cell(page, 'boards'));
    expect(moved).toBe('3/3'); // two cells right and two down from the first cell
    await expect(page.getByRole('dialog', { name: 'Boards window' })).toHaveCount(0); // the drag did not open it
    await page.waitForTimeout(1200); // the layout is saved a moment later
    await page.reload();
    await expect(page.locator('[data-app-icon="boards"]')).toBeVisible();
    expect(await place(cell(page, 'boards'))).toBe(moved);
    await page.locator('[data-app-icon="boards"]').click();
    await expect(page.getByRole('dialog', { name: 'Boards window' })).toBeVisible();
  });

  test('icons move from the keyboard menu with the new place announced, and Settings cannot be hidden', async ({ page }) => {
    await start(page);
    const rings = page.locator('[data-app-icon="rings"]');
    await rings.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rings moved to row 2' })).toBeVisible();
    await page.locator('[data-app-icon="settings"]').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Hide from the desktop' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await scan(page, 'the desktop with a moved icon');
  });

  test('an app can be hidden from the desktop, stays in the Apps menu, comes back, and Reset undoes it all', async ({ page }) => {
    await start(page);
    await page.locator('[data-app-icon="files"]').focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Hide from the desktop' }).click();
    await expect(page.locator('[data-app-icon="files"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /Files/ })).toBeVisible(); // still reachable
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.locator('[data-app-icon="boards"]')).toBeVisible();
    await expect(page.locator('[data-app-icon="files"]')).toHaveCount(0);
    // The bare desktop's menu offers it back, and Reset puts everything as it was.
    await page.locator('.desktop-layout').click({ button: 'right', position: { x: 4, y: 300 } });
    await page.getByRole('menuitem', { name: 'Show Files on the desktop' }).click();
    await expect(page.locator('[data-app-icon="files"]')).toBeVisible();
    await page.locator('[data-app-icon="rings"]').focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Move down' }).click();
    await page.locator('.desktop-layout').click({ button: 'right', position: { x: 4, y: 300 } });
    await page.getByRole('menuitem', { name: 'Put the desktop back as it was' }).click();
    await expect.poll(() => place(cell(page, 'rings'))).toBe('2/1');
  });

  test('a window can be added to the desktop as a shortcut that opens it again, and removed', async ({ page }) => {
    await start(page);
    await page.locator('[data-app-icon="boards"]').click();
    const win = page.getByRole('dialog', { name: 'Boards window' });
    await expect(win).toBeVisible();
    await win.locator('.window-title').click({ button: 'right', position: { x: 160, y: 10 } });
    await page.getByRole('menuitem', { name: 'Add to the desktop' }).click();
    await expect(page.getByText('Added to the desktop.')).toBeVisible();
    const sc = page.locator('[data-shortcut]');
    await expect(sc).toHaveCount(1);
    await expect(sc).toHaveAccessibleName(/Open .* \(shortcut\)/);
    // Adding the same place again says so and does not add a second icon.
    await win.locator('.window-title').click({ button: 'right', position: { x: 160, y: 10 } });
    await page.getByRole('menuitem', { name: 'Add to the desktop' }).click();
    await expect(page.getByText('It is already on the desktop.')).toBeVisible();
    await expect(sc).toHaveCount(1);
    await scan(page, 'the desktop with a shortcut');
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(sc).toHaveCount(1);
    await page.getByRole('button', { name: 'Close Boards' }).click().catch(() => undefined);
    await sc.click();
    await expect(page.getByRole('dialog', { name: 'Boards window' })).toBeVisible();
    // Its menu removes it.
    await sc.focus();
    await page.keyboard.press('Shift+F10');
    await page.getByRole('menuitem', { name: 'Remove this shortcut' }).click();
    await expect(sc).toHaveCount(0);
  });

  test('a bookmark becomes a shortcut that opens in a new tab, and shows as missing once the bookmark is gone', async ({ page }) => {
    await start(page);
    const made = await (await page.request.post('/api/v1/bookmarks', { data: { url: 'https://nowhere.invalid/shortcut', title: 'Garden notes', description: '' }, headers: h })).json();
    await page.goto('/bookmarks');
    await page.getByRole('button', { name: 'Add to the desktop: Garden notes' }).click();
    await expect(page.getByText('Added to the desktop.')).toBeVisible();
    await page.waitForTimeout(1200);
    await page.goto('/');
    const sc = page.locator('[data-shortcut]');
    await expect(sc).toHaveAccessibleName('Open Garden notes (shortcut)');
    await page.context().route('https://nowhere.invalid/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>garden</title>' }));
    const popup = page.waitForEvent('popup');
    await sc.click();
    expect((await popup).url()).toContain('nowhere.invalid');
    await page.request.delete(`/api/v1/bookmarks/${made.bookmark.id}`, { headers: h });
    await page.reload();
    await expect(page.locator('[data-shortcut]')).toHaveAccessibleName('Missing: Garden notes');
    await page.locator('[data-shortcut]').focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: /Open Garden notes/ })).toBeDisabled();
    await page.getByRole('menuitem', { name: 'Remove this shortcut' }).click();
    await expect(page.locator('[data-shortcut]')).toHaveCount(0);
  });
});

test('on a phone the apps can be hidden and put in another order in Settings, and the home screen follows', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the launcher is the phone home screen');
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/appearance');
  await page.getByLabel('Files', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Move Memos earlier' }).click();
  await scan(page, 'the desktop and home screen settings');
  await page.waitForTimeout(1200);
  await page.goto('/');
  const apps = page.getByRole('navigation', { name: 'Apps' });
  await expect(apps.getByRole('link', { name: 'Boards' })).toBeVisible();
  await expect(apps.getByRole('link', { name: 'Files' })).toHaveCount(0);
  const names = (await apps.getByRole('link').allInnerTexts()).map((n) => n.replace(/^\d+\s*/, '').trim()); // page numbers come first
  expect(names.indexOf('Memos')).toBeLessThan(names.indexOf('Bookmarks'));
});

test('shortcuts show on the phone home screen and can be removed in Settings', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the launcher is the phone home screen');
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  const put = await page.request.put('/api/v1/me/client-settings/desktop', { headers: h, data: { settings: { shortcuts: [{ id: 's_phone1', label: 'Board talk', target: { type: 'place', app: 'boards', path: '' } }] } } });
  expect(put.ok()).toBe(true);
  await page.goto('/');
  const link = page.getByRole('navigation', { name: 'Apps' }).getByRole('link', { name: 'Open Board talk (shortcut)' });
  await expect(link).toBeVisible();
  await scan(page, 'the home screen with a shortcut');
  await link.click();
  await expect(page).toHaveURL(/\/boards$/);
  await page.goto('/settings/appearance');
  await page.getByRole('button', { name: 'Remove this shortcut: Board talk' }).click();
  await expect(page.getByRole('button', { name: 'Remove this shortcut: Board talk' })).toHaveCount(0);
  // The note that says so sits above the tab bar, not under it.
  const note = page.getByText('Shortcut removed.');
  await expect(note).toBeVisible();
  const tabs = (await page.getByRole('navigation', { name: 'Main sections' }).boundingBox())!;
  await expect.poll(async () => { const box = (await note.boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(tabs.y); // once it has slid in
  await page.waitForTimeout(1200);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Open Board talk (shortcut)' })).toHaveCount(0);
});

test('the home panel can be rearranged: move, hide, add back, and it is kept', async ({ page, isMobile }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  const order = () => page.locator('.home > .widget').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.widget));
  await expect(page.locator('.home')).toBeVisible();
  await page.getByRole('button', { name: 'Change the home panel' }).click();
  // While arranging, every widget has its controls, even ones with nothing in them yet.
  await page.getByRole('button', { name: 'Move Memos up' }).click();
  await page.getByRole('button', { name: 'Move Memos up' }).click();
  const moved = await order();
  expect(moved.indexOf('memos')).toBeLessThan(moved.indexOf('wall'));
  await page.getByRole('button', { name: 'Hide The wall' }).click();
  await expect(page.locator('[data-widget="wall"]')).toHaveCount(0);
  if (!isMobile) {
    await page.getByRole('button', { name: 'Make Memos wide' }).click();
    await expect(page.getByRole('button', { name: 'Make Memos wide' })).toHaveAttribute('aria-pressed', 'true');
  }
  await scan(page, 'the home panel while arranging');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Change the home panel' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('.home')).toBeVisible();
  const after = await order();
  expect(after).not.toContain('wall');
  expect(after.indexOf('memos')).toBeLessThan(after.indexOf('bookmarks'));
  // Add it back.
  await page.getByRole('button', { name: 'Change the home panel' }).click();
  await page.getByRole('button', { name: 'Add The wall' }).click();
  await expect(page.locator('[data-widget="wall"]')).toHaveCount(1);
});

test('folders: put an app in a new folder, open it, take it out again', async ({ page, isMobile }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  if (isMobile) {
    // The phone shows folders made on the account (here through the settings route) and opens them as a sheet.
    const put = await page.request.put('/api/v1/me/client-settings/desktop', { headers: h, data: { settings: { folders: [{ id: 'f_phone1', name: 'Reading', items: ['wiki', 'bookmarks'] }] } } });
    expect(put.ok()).toBe(true);
    await page.goto('/');
    const apps = page.getByRole('navigation', { name: 'Apps' });
    await expect(apps.getByRole('link', { name: /Wiki/ })).toHaveCount(0);
    await apps.getByRole('button', { name: 'Folder Reading, 2 items' }).click();
    const sheet = page.getByRole('dialog', { name: 'Reading' });
    await sheet.getByRole('button', { name: 'Wiki', exact: true }).click();
    await expect(page).toHaveURL(/\/wiki/);
    return;
  }
  await page.goto('/');
  page.once('dialog', (d) => void d.accept('Reading'));
  await page.locator('[data-app-icon="wiki"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Put in a new folder' }).click();
  const folder = page.getByRole('button', { name: 'Folder Reading, 1 items' });
  await expect(folder).toBeVisible();
  await expect(page.locator('[data-app-icon="wiki"]')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await page.reload();
  await folder.click();
  const panel = page.getByRole('dialog', { name: 'Reading' });
  await scan(page, 'an open folder');
  await panel.getByRole('button', { name: 'Take Wiki out of the folder' }).click();
  await expect(panel.getByText('Nothing in here yet.', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('[data-app-icon="wiki"]')).toBeVisible();
});

test('a memo pinned to the desktop shows as a note that can be edited and unpinned', async ({ page, isMobile }) => {
  test.skip(isMobile, 'notes sit on the big-screen desktop');
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  const memo = await (await page.request.post('/api/v1/memos', { headers: h, data: { body: 'Buy patch cables' } })).json();
  await page.goto('/memos');
  await page.getByRole('button', { name: 'Put on the desktop: Buy patch cables' }).click();
  await expect(page.getByText('Pinned to the desktop.')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.goto('/');
  const note = page.locator(`[data-note="${memo.id}"]`);
  await expect(note).toContainText('Buy patch cables');
  await scan(page, 'a note on the desktop');
  await note.getByRole('button', { name: 'Edit this note' }).click();
  await note.getByLabel('The note').fill('Buy patch cables and a new case');
  await note.getByRole('button', { name: 'Save' }).click();
  await expect(note).toContainText('and a new case');
  expect((await (await page.request.get(`/api/v1/memos/${memo.id}`)).json()).body).toBe('Buy patch cables and a new case');
  await note.getByRole('button', { name: /Take this note off the desktop/ }).click();
  await expect(note).toHaveCount(0);
  expect((await page.request.get(`/api/v1/memos/${memo.id}`)).ok()).toBe(true); // the memo stays
});
