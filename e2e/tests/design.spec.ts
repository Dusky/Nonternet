import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// The design pass (docs/10): the landing page, the home panel, the palette, window keys, the phone
// tab bar and the confirm dialog. Accessibility is checked on each new screen, in light, dark and amber.
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}

test('the landing page shows public threads, a count of people online, and how to connect', async ({ page }) => {
  const owner = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  const api = page.context().request;
  await api.post('/api/v1/auth/login', { data: { identifier: owner.handle, password: PASSWORD }, headers: h });
  const slug = uniq('front');
  const subject = `Front page ${slug}`;
  await api.post('/api/v1/boards', { data: { slug, name: 'Front', visibility: 'public' }, headers: h });
  await api.post(`/api/v1/boards/${slug}/posts`, { data: { subject, body: 'Seen from the front page.' }, headers: h });
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const recent = page.getByRole('region', { name: 'Recent threads' });
  await expect(recent.getByRole('link', { name: subject })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How to connect' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' })).toHaveCount(1);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await scan(page, `landing (${scheme})`);
  }
  await recent.getByRole('link', { name: subject }).click();
  await expect(page.getByText('Seen from the front page.')).toBeVisible();
});

test('the home panel shows what is new and a getting-started list that can be hidden', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  const home = page.getByRole('region', { name: /^Hello,/ });
  await expect(home).toBeVisible();
  await expect(home.getByRole('button', { name: /new posts?$/ })).toBeVisible();
  const start = page.getByRole('region', { name: 'Getting started' });
  await expect(start.getByRole('button', { name: 'Write a short bio' })).toBeVisible();
  await scan(page, 'home with the home panel');
  await start.getByRole('button', { name: 'Hide' }).click();
  await expect(start).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: /^Hello,/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Getting started' })).toHaveCount(0);
});

test.describe('on a big screen', () => {
  test.skip(({ isMobile }) => isMobile, 'windows and the taskbar are for big screens');

  test('Ctrl+K opens the palette; typing finds an app and Enter opens it', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Go to an app, board, setting or person' });
    await expect(box).toBeFocused();
    await scan(page, 'the palette');
    await box.fill('sett');
    await expect(page.getByRole('option', { name: /Settings/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Settings window' })).toBeVisible();
    // A handle becomes "Profile of …".
    await page.keyboard.press('Control+k');
    await box.fill(u.handle);
    await page.getByRole('option', { name: `Profile of ${u.handle}` }).click();
    await expect(page.getByRole('dialog', { name: 'People window' })).toBeVisible();
  });

  test('Alt+` brings the next window forward, focus goes into new windows, and Alt+arrow snaps', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.getByRole('button', { name: 'Open Boards' }).click();
    const boards = page.getByRole('dialog', { name: 'Boards window' });
    await expect(boards.locator('.window-title')).toBeFocused();
    await page.getByRole('button', { name: 'Open Rings' }).click();
    const rings = page.getByRole('dialog', { name: 'Rings window' });
    await expect(rings).toHaveClass(/is-focused/);
    await page.locator('body').press('Alt+Backquote');
    await expect(boards).toHaveClass(/is-focused/);
    await page.locator('body').press('Alt+Backquote');
    await expect(rings).toHaveClass(/is-focused/);
    await rings.locator('.window-title').focus();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(async () => (await rings.boundingBox())!.x).toBe(0);
    // Closing gives focus to the window behind.
    await page.getByRole('button', { name: 'Close Rings' }).click();
    await expect(boards.locator('.window-title')).toBeFocused();
  });

  test('the apps menu works from the keyboard and Escape returns focus to its button', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    const button = page.getByRole('button', { name: 'Apps', exact: true });
    await button.click();
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('the taskbar clock can be switched off in Settings', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await expect(page.locator('.taskbar time.clock')).toBeVisible();
    await page.goto('/settings/appearance');
    await page.getByLabel('Show the time in the taskbar').uncheck();
    await expect(page.locator('.taskbar time.clock')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout only');

  test('a tab bar along the bottom reaches the main places and marks where you are', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    const tabs = page.getByRole('navigation', { name: 'Main sections' });
    await expect(tabs.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: 'Boards' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();
    await expect(tabs.getByRole('link', { name: 'Boards' })).toHaveAttribute('aria-current', 'page');
    await scan(page, 'boards with the tab bar');
  });
});

test('confirming in the site dialog: Cancel leaves things alone and returns focus; the named button does it', async ({ page }) => {
  const a = await makeUser(page);
  const b = await makeUser(page);
  await signIn(page, a.handle, PASSWORD);
  await page.goto(`/people/${b.handle}`);
  const block = page.getByRole('button', { name: 'Block', exact: true });
  await block.click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused(); // the safe choice for a risky action
  await scan(page, 'the confirm dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(block).toBeFocused();
  await block.click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page.getByText('You have blocked this person.')).toBeVisible();
});

test('amber: the new screens keep their contrast', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ui:theme', 'amber'));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await scan(page, 'landing (amber)');
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await expect(page.getByRole('region', { name: /^Hello,/ })).toBeVisible();
  await scan(page, 'home (amber)');
});
