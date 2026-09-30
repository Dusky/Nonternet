import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { makeAdmin, makeUser, PASSWORD, signIn, totp } from '../support/helpers';

async function scan(page: Page, what: string) {
  // xterm.js draws the screen itself; its helper textarea and rows are checked by its own project.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('.xterm').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test('the Terminal window calls the BBS with no login prompt, and the console sees the caller', async ({ page, browser }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/terminal');
  const screen = page.locator('.xterm-rows');
  await expect(screen).toContainText('Main menu [', { timeout: 15_000 });
  await expect(screen).not.toContainText('Handle:');
  await scan(page, 'the Terminal window');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('w');
  await expect(screen).toContainText(u.handle);
  // The key bar sends keys a phone lacks.
  await page.getByRole('button', { name: 'Enter' }).click();
  await page.getByRole('button', { name: 'Use your own terminal program' }).click();
  await expect(page.getByText(/telnet 127\.0\.0\.1 \d+/)).toBeVisible();

  const admin = await makeAdmin(page);
  const ap = await browser.newContext({ baseURL: page.url().replace(/\/terminal.*/, '') }).then((c) => c.newPage());
  await signIn(ap, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  await ap.goto('/admin/bbs');
  await expect(ap.getByRole('cell', { name: u.handle })).toBeVisible({ timeout: 10_000 });
  await scan(ap, 'the BBS console page');
});

test('SSH keys are added and removed in Settings, Terminal', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/terminal');
  await expect(page.getByRole('heading', { name: 'SSH keys for the BBS' })).toBeVisible();
  await page.getByLabel('Public key').fill('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl me@laptop');
  await page.getByRole('button', { name: 'Add key' }).click();
  await expect(page.getByText('me@laptop')).toBeVisible();
  await expect(page.getByText(/^SHA256:/)).toBeVisible();
  await scan(page, 'the SSH keys list');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Remove the key me@laptop' }).click();
  await expect(page.getByText('No keys yet.')).toBeVisible();
});
