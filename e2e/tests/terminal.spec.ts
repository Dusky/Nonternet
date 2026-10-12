import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { makeAdmin, makeUser, PASSWORD, signIn, totp } from '../support/helpers';

async function scan(page: Page, what: string) {
  // xterm.js draws the screen itself; its helper textarea and rows are checked by its own project.
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('.xterm').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test('the Terminal window calls the BBS with no login prompt, and the console sees the caller', async ({ page, browser, isMobile }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/terminal');
  const screen = page.locator('.xterm-rows');
  await expect(screen).toContainText('Main menu [', { timeout: 15_000 });
  await expect(screen).not.toContainText('Handle:');
  if (isMobile) {
    // The prompt and the key bar are on the screen, above the tab bar, without scrolling.
    const keys = (await page.getByRole('group', { name: 'Extra keys' }).boundingBox())!;
    const bar = (await page.getByRole('navigation', { name: 'Main sections' }).boundingBox())!;
    expect(keys.y + keys.height).toBeLessThanOrEqual(bar.y);
  }
  await scan(page, 'the Terminal window');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('w');
  // The list pages when many people are on (it is a shared test site), so the screen's title is the proof the key got through.
  await expect(screen).toContainText(/Who's online|press a key/); // a long list pages, and on a short phone screen the title has scrolled off
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
  await page.getByRole('button', { name: 'Remove the key me@laptop' }).click(); // acts at once; Undo is in the note
  await expect(page.getByText('No keys yet.')).toBeVisible();
  // ...and is saved once the Undo window has passed.
  await expect.poll(async () => (await (await page.request.get('/api/v1/me/ssh-keys')).json()).keys.length, { timeout: 15_000 }).toBe(0);
});

test('offline mail: download a QWK packet from Settings, Terminal', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/terminal');
  await expect(page.getByRole('heading', { name: 'Offline mail (QWK)' })).toBeVisible();
  await scan(page, 'the offline mail panel');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download new messages \(E2ETEST\.QWK\)/ }).click()]);
  expect(download.suggestedFilename()).toBe('E2ETEST.QWK');
  await expect(page.getByText(/Your packet has \d+ new messages\./)).toBeVisible();
  await expect(page.getByLabel('Send your replies (E2ETEST.REP)')).toBeVisible();
});

test('the call state sits in one line: hang up, keys while not connected are not lost silently, Call again starts clean', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/terminal');
  const screen = page.locator('.xterm-rows');
  await expect(screen).toContainText('Main menu [', { timeout: 15_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Connected to the BBS.' })).toBeVisible();
  const box = await page.locator('.terminal-screen').boundingBox();

  await page.getByRole('button', { name: 'Hang up' }).click();
  await expect(page.getByText('You hung up.')).toBeVisible();
  expect((await page.locator('.terminal-screen').boundingBox())!.height).toBe(box!.height); // nothing moved
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type('w');
  await expect(page.getByText('Not connected, so that was not sent.')).toBeVisible();

  await page.getByRole('button', { name: 'Call again' }).click();
  await expect(screen).toContainText('Main menu [', { timeout: 15_000 });

  // A refused ticket says why, and Call again is right there.
  await page.route('**/api/v1/bbs/ticket', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'The BBS is resting.' } }) }));
  await page.getByRole('button', { name: 'Hang up' }).click();
  await page.getByRole('button', { name: 'Call again' }).click();
  await expect(page.getByText('The BBS is resting.')).toBeVisible();
  await page.unroute('**/api/v1/bbs/ticket');
  await page.getByRole('button', { name: 'Call again' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Connected to the BBS.' })).toBeVisible({ timeout: 15_000 });
});
