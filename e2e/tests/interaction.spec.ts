import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// The shared widgets (menus, the palette, the confirm dialog) come from React Aria and cmdk. These walk the
// keyboard paths people rely on: arrows, typing a letter, Escape, and focus going back where it was.

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}

test.describe('on a big screen', () => {
  test.skip(({ isMobile }) => isMobile, 'the taskbar menus are for big screens');

  test('menus: typing a letter jumps to an item, and a click elsewhere closes the menu', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    const account = page.getByRole('button', { name: `Account menu for ${u.handle}` });
    await account.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await scan(page, 'the account menu');
    await page.keyboard.press('l'); // "Log out"
    await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.mouse.click(10, 400);
    await expect(menu).toHaveCount(0);

    // Enter on the button opens it too, and choosing an item does what it says.
    await account.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('s'); // "Settings"
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Settings window' })).toBeVisible();
  });

  test('the palette matches letters in order and closes with Escape, giving focus back', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    const search = page.getByRole('button', { name: 'Search and jump' });
    await search.click();
    const box = page.getByRole('combobox', { name: 'Go to an app, board, setting or person' });
    await expect(box).toBeFocused();
    await box.fill('stngs'); // not a substring of "Settings", but the letters are in order
    await expect(page.getByRole('option', { name: /Settings/ }).first()).toBeVisible();
    await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('option', { selected: true })).toContainText('Settings');
    await box.fill('qq zz!'); // can't be a handle either
    await expect(page.getByText('Nothing matches.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(search).toBeFocused();
  });
});

test('the confirm dialog: Tab stays inside it, and the rest of the page is out of reach until it closes', async ({ page }) => {
  const a = await makeUser(page);
  const b = await makeUser(page);
  await signIn(page, a.handle, PASSWORD);
  await page.goto(`/people/${b.handle}`);
  const block = page.getByRole('button', { name: 'Block', exact: true });
  await block.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  // The page behind is inert (or aria-hidden where inert isn't supported): out of reach for clicks, keys and screen readers.
  expect(await page.locator('main').evaluate((m) => m.closest('[inert], [aria-hidden="true"]') !== null)).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(block).toBeFocused();
});
