import { expect, test } from '../support/fixtures';
import type { Locator, Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, signIn } from '../support/helpers';

const box = async (l: Locator) => (await l.boundingBox())!;
const z = (l: Locator) => l.evaluate((el) => Number(getComputedStyle(el).zIndex));

async function dragBy(page: Page, from: Locator, dx: number, dy: number, at = { x: 24, y: 10 }) {
  const b = await box(from);
  await page.mouse.move(b.x + at.x, b.y + at.y);
  await page.mouse.down();
  await page.mouse.move(b.x + at.x + dx, b.y + at.y + dy, { steps: 6 });
  await page.mouse.up();
}

test.describe('desktop windows', () => {
  test.skip(({ isMobile }) => isMobile, 'windows are for big screens; phones get the launcher');

  async function signedInUser(page: Page) {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible();
    return u;
  }

  test('shows an icon per app the person may use, and only those', async ({ page }) => {
    await signedInUser(page);
    await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Boards' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Admin console' })).toHaveCount(0);
  });

  test('opens an app in a window, once, and does not touch the address bar', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await expect(win).toBeVisible();
    await win.getByRole('link', { name: 'Password', exact: true }).click();
    await expect(win.getByLabel('Current password')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/'); // moving around inside a window leaves the address alone
    // The window now covers the icon, so open it again the way a person would: from the Apps menu.
    await page.getByRole('button', { name: 'Apps' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings window' })).toHaveCount(1);
  });

  test('moves when its title bar is dragged, and resizes from its corner', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    const before = await box(win);
    await dragBy(page, win.locator('header.window-title'), 200, 90);
    const moved = await box(win);
    expect(Math.round(moved.x - before.x)).toBe(200);
    expect(Math.round(moved.y - before.y)).toBe(90);

    await dragBy(page, win.locator('.edge-se'), 120, 60, { x: 8, y: 8 });
    const resized = await box(win);
    expect(Math.round(resized.width - before.width)).toBe(120);
    expect(Math.round(resized.height - before.height)).toBe(60);
  });

  test('can be moved and resized from the keyboard', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    const title = win.locator('header.window-title');
    const before = await box(win);
    await title.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    const after = await box(win);
    expect(Math.round(after.x - before.x)).toBe(16);
    expect(Math.round(after.y - before.y)).toBe(16);
    expect(Math.round(after.width - before.width)).toBe(16);
  });

  test('maximizes to fill the desktop above the taskbar and restores to where it was', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await dragBy(page, win.locator('header.window-title'), 40, 30);
    const before = await box(win);
    await page.getByRole('button', { name: 'Maximize Settings' }).click();
    const max = await box(win);
    expect(max).toMatchObject({ x: 0 });
    expect(Math.round(max.width)).toBe(1280);
    expect(Math.round(max.y + max.height)).toBe(800); // right down to the bottom edge of the page
    await page.getByRole('button', { name: 'Restore Settings' }).click();
    const back = await box(win);
    expect([Math.round(back.x), Math.round(back.y), Math.round(back.width)]).toEqual([Math.round(before.x), Math.round(before.y), Math.round(before.width)]);
  });

  test('minimizes to the taskbar, comes back from it, and closes', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await page.getByRole('button', { name: 'Minimize Settings' }).click();
    await expect(win).toBeHidden();
    await page.getByRole('button', { name: 'Show Settings' }).click();
    await expect(win).toBeVisible();
    await page.getByRole('button', { name: 'Close Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings window' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show Settings' })).toHaveCount(0);
  });

  test('keeps the window you clicked last on top', async ({ page, browser }) => {
    const admin = await makeAdmin(page);
    await signIn(page, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
    await page.getByRole('button', { name: 'Open Settings' }).click();
    await page.getByRole('button', { name: 'Apps' }).click();
    await page.getByRole('menuitem', { name: 'Admin console' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings window' });
    const adminWin = page.getByRole('dialog', { name: 'Admin console window' });
    expect(await z(adminWin)).toBeGreaterThan(await z(settings));
    await settings.locator('header.window-title h2').click();
    expect(await z(settings)).toBeGreaterThan(await z(adminWin));
    void browser;
  });

  test('reopens a window where it was left, even after a reload', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    let win = page.getByRole('dialog', { name: 'Settings window' });
    await dragBy(page, win.locator('header.window-title'), 150, 70);
    const placed = await box(win);
    await page.getByRole('button', { name: 'Close Settings' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Open Settings' }).click();
    win = page.getByRole('dialog', { name: 'Settings window' });
    const again = await box(win);
    expect([Math.round(again.x), Math.round(again.y)]).toEqual([Math.round(placed.x), Math.round(placed.y)]);
  });

  test('a smaller browser window pulls the windows back into view', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await dragBy(page, win.locator('header.window-title'), 700, 400); // far right and low, but still reachable
    await page.setViewportSize({ width: 950, height: 520 });
    // Page coordinates: the title bar (about 40px tall) must end up fully inside the browser window.
    await expect.poll(async () => { const b = await box(win); return b.x <= 950 - 90 && b.y + 40 <= 520 + 1; }).toBe(true);
  });

  test('shrinking to phone size swaps windows for the launcher, and widening again brings them back', async ({ page }) => {
    await signedInUser(page);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await dragBy(page, win.locator('header.window-title'), 100, 60);
    const placed = await box(win);
    await page.setViewportSize({ width: 600, height: 800 });
    await expect(page.getByRole('navigation', { name: 'Apps' })).toBeVisible();
    await expect(win).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(win).toBeVisible();
    const back = await box(win);
    expect([Math.round(back.x), Math.round(back.y)]).toEqual([Math.round(placed.x), Math.round(placed.y)]);
  });
});

test.describe('themes', () => {
  test.skip(({ isMobile }) => isMobile, 'covered on the desktop; the phone uses the same controls');

  test('switches to the amber screen, saves it to the profile, and keeps effects switchable', async ({ page, browser }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'modern');
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await win.getByRole('link', { name: 'Appearance' }).click();
    await win.getByLabel('Amber screen').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber');
    await expect(page.getByText('Theme saved.')).toBeVisible(); // a toast, outside the window
    await expect(page.locator('html')).toHaveAttribute('data-scanlines', 'on');
    await expect(page.locator('html')).toHaveAttribute('data-glow', 'on');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(18, 11, 0)');

    await win.getByLabel('Scanlines').uncheck();
    await expect(page.locator('html')).toHaveAttribute('data-scanlines', 'off');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'amber');
    await expect(page.locator('html')).toHaveAttribute('data-scanlines', 'off'); // the choice survives a reload

    // the theme is on the profile, so a different browser gets it after logging in
    const other = await browser.newContext({ baseURL: BASE_URL });
    const otherPage = await other.newPage();
    await signIn(otherPage, u.handle, PASSWORD);
    await expect(otherPage.locator('html')).toHaveAttribute('data-theme', 'amber');
    await other.close();
  });

  test('offers no effects for the modern theme', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await win.getByRole('link', { name: 'Appearance' }).click();
    await expect(win.getByLabel('Modern')).toBeChecked();
    await expect(win.getByLabel('Scanlines')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout only');

  test('shows a launcher of apps, opens one full screen at its own address, and goes back', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await expect(page.getByRole('navigation', { name: 'Apps' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Minimize|Maximize|Close) / })).toHaveCount(0); // no windows on a phone
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('every control that matters is big enough to tap', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.getByRole('link', { name: 'Settings' }).click();
    for (const target of [
      page.getByRole('link', { name: 'Back' }), page.getByRole('button', { name: /Account menu/ }),
      page.getByRole('link', { name: 'Password', exact: true }), page.getByLabel('Display name (optional)'), page.getByRole('button', { name: 'Save' }),
    ]) {
      const b = await box(target);
      expect(b.height, await target.evaluate((el) => el.outerHTML.slice(0, 60))).toBeGreaterThanOrEqual(44);
      expect(b.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('an app page can be opened directly by its address', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/settings/two-factor');
    await expect(page.getByText('Two-factor authentication is off.')).toBeVisible();
  });
});
