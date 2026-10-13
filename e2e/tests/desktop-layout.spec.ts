import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Locator, Page } from '@playwright/test';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

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
  const names = await apps.getByRole('link').allInnerTexts();
  expect(names.indexOf('Memos')).toBeLessThan(names.indexOf('Bookmarks'));
});
