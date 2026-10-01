import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Desktop feel (M9-B, docs/10): what the browser tab says, windows that come back, recovery, right-click menus,
// the shortcuts sheet, and a window's own Back and Forward.
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}
async function signedInPage(browser: Browser, handle: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await signIn(page, handle, PASSWORD);
  return page;
}

test.describe('on a big screen', () => {
  test.skip(({ isMobile }) => isMobile, 'windows and the taskbar are for big screens');

  test('the windows that were open come back after a reload, and not for the next person', async ({ page, browser }) => {
    const a = await makeUser(page);
    await signIn(page, a.handle, PASSWORD);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await win.getByRole('link', { name: 'Appearance' }).click();
    await page.getByRole('button', { name: 'Open Rings' }).click();
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Settings window' }).getByRole('link', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('dialog', { name: 'Rings window' })).toBeVisible();

    // Logging out clears it: the next person at this browser starts with a clean desktop.
    await page.getByRole('button', { name: `Account menu for ${a.handle}` }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    const b = await makeUser(page);
    await signIn(page, b.handle, PASSWORD);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    void browser;
  });

  test('a link inside a window has a real address, and Back and Forward are the window\'s own', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.getByRole('button', { name: 'Open Settings' }).click();
    const win = page.getByRole('dialog', { name: 'Settings window' });
    await expect(win.getByRole('link', { name: 'Appearance' })).toHaveAttribute('href', '/settings/appearance');
    await win.getByRole('link', { name: 'Appearance' }).click();
    await win.getByRole('link', { name: 'Password', exact: true }).click();
    await win.getByRole('button', { name: 'Back in Settings' }).click();
    await expect(win.getByRole('link', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    await win.getByRole('button', { name: 'Forward in Settings' }).click();
    await expect(win.getByRole('link', { name: 'Password', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(win.getByRole('button', { name: 'Forward in Settings' })).toBeDisabled();
  });

  test('the tab title says where you are, and what is waiting', async ({ page, browser }) => {
    const owner = await makeUser(page);
    await setRole(owner.handle, 'trusted');
    const other = await makeUser(page);
    const slug = uniq('tab');
    const op = await signedInPage(browser, owner.handle);
    await op.request.post('/api/v1/boards', { data: { slug, name: `Tab ${slug}`, visibility: 'public' }, headers: h });
    const t = await (await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: `Subject ${slug}`, body: 'Hello.' }, headers: h })).json();
    await op.goto(`/boards/${slug}/t/${t.id}`);
    await expect(op).toHaveTitle(new RegExp(`^Boards — Subject ${slug} · `));

    await signIn(page, other.handle, PASSWORD);
    await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: `Hi @${owner.handle}`, reply_to: t.id }, headers: h });
    await expect(op).toHaveTitle(/^\(1\) Boards/, { timeout: 8000 }); // pushed, with no reload
    await op.context().close();
  });

  test('offline shows a banner, and coming back removes it', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.context().setOffline(true);
    await expect(page.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByText('You are offline')).toHaveCount(0);
  });

  test('being signed out in the background is said plainly, with a way back in', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.context().clearCookies();
    await page.getByRole('button', { name: 'Open Mail' }).click(); // asks the server, which says no
    const banner = page.getByRole('alert').filter({ hasText: 'You have been signed out' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', /\/login\?return_to=/);
    await scan(page, 'the signed-out banner');
  });

  test('right-click opens a menu on the desktop and the taskbar, and it is reachable from the keyboard', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.getByRole('button', { name: 'Open Rings' }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Open on a page of its own' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.getByRole('button', { name: 'Open Rings' }).click();
    const rings = page.getByRole('dialog', { name: 'Rings window' });
    await page.getByRole('button', { name: 'Show Rings' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Fill the left half of the screen' }).click();
    await expect.poll(async () => (await rings.boundingBox())!.x).toBe(0);

    // Keyboard: Shift+F10 on the desktop icon.
    const icon = page.getByRole('button', { name: 'Open Boards' });
    await icon.focus();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(icon).toBeFocused();
  });

  test('? lists every shortcut', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.locator('body').press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Bring the next window forward')).toBeVisible();
    await scan(page, 'the shortcuts sheet');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('the wallpaper choice sticks, and the chime setting is kept on this device', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/settings/appearance');
    await page.getByLabel('Grid').check();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'grid');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'grid');

    await page.goto('/settings/notifications');
    await scan(page, 'settings notifications');
    await page.getByLabel('Play a short chime').check();
    await page.reload();
    await expect(page.getByLabel('Play a short chime')).toBeChecked();
  });

  test('the palette finds a thread by its words and remembers what you opened', async ({ page, browser }) => {
    const owner = await makeUser(page);
    await setRole(owner.handle, 'trusted');
    const slug = uniq('pal');
    const word = `zebrafish${uniq('')}`;
    const op = await signedInPage(browser, owner.handle);
    await op.request.post('/api/v1/boards', { data: { slug, name: `Palette ${slug}`, visibility: 'public' }, headers: h });
    await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: `About ${word}`, body: `All about ${word}.` }, headers: h });
    await op.context().close();

    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill(word);
    await page.getByRole('option', { name: new RegExp(`About ${word}`) }).click();
    await expect(page.getByRole('dialog', { name: 'Boards window' })).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('option', { name: new RegExp(`About ${word}`) })).toBeVisible(); // remembered
  });
});
