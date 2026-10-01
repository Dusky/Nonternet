import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeAdmin, makeUser, PASSWORD, signIn, uniq } from '../support/helpers';
import { cli, CORE_PORT, EVENNIA_BIN } from '../support/stack';

// A walk through the site the way a newcomer meets it, with a screenshot at each step and a video of the whole thing. Not a test of
// anything: skipped unless WALKTHROUGH names a folder, e.g. WALKTHROUGH=/tmp/walk pnpm --filter @app/e2e test walkthrough
// The demo community (docs/19) is put in first, so there is something to look at.
const OUT = process.env.WALKTHROUGH;
test.skip(!OUT, 'set WALKTHROUGH=<folder> to take the walkthrough');
test.use({ video: 'on', actionTimeout: 15_000, navigationTimeout: 20_000 });

const world = (page: Page) => page.getByRole('log', { name: 'What happens in the world' });
async function type(page: Page, text: string) {
  await page.getByLabel('Type a command, like look or north').fill(text);
  await page.getByLabel('Type a command, like look or north').press('Enter');
}

test('a newcomer, a player and an admin walk the site', async ({ page, isMobile }, info) => {
  test.setTimeout(300_000);
  const dir = join(OUT!, info.project.name);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const shot = async (name: string) => { await page.waitForTimeout(500); await page.screenshot({ path: join(dir, `${String(++n).padStart(2, '0')}-${name}.png`) }); };
  cli(['seed-demo', '--url', `http://127.0.0.1:${CORE_PORT}`]);

  // A visitor.
  await page.goto('/signup'); await shot('signup-by-invite');
  await page.goto('/boards/synths'); await shot('visitor-reads-a-board');

  // Someone new who has just been let in.
  const me = await makeUser(page, { handle: uniq('newcomer') });
  await signIn(page, me.handle, PASSWORD);
  await shot('first-home');
  await page.goto('/settings/profile'); await shot('settings-profile');

  if (EVENNIA_BIN) {
    await page.goto('/mud');
    await expect(world(page).getByText('You have no character yet.', { exact: false })).toBeVisible({ timeout: 20_000 });
    await shot('mud-first-screen');
    await type(page, 'charcreate');
    await expect(world(page).getByText('Accept and create character').last()).toBeVisible();
    await shot('mud-character-sheet');
    await type(page, '3');
    const ready = world(page).getByText(/ is ready\./);
    await expect(ready).toBeVisible();
    const name = /^(\S+) is ready\./.exec((await ready.textContent()) ?? '')![1]!;
    await type(page, `ic ${name}`);
    await expect(world(page).getByText('Town square').last()).toBeVisible();
    await shot('mud-town-square');
    for (const [cmd, wait, label] of [['east', 'The tavern', 'mud-tavern'], ['ask marta', 'lost ledger', 'mud-quest-start'], ['board', 'Pinned to the board|board is bare', 'mud-noticeboard'], ['post Looking for a group to try the Flooded Mine', 'pin your note', 'mud-posted-a-note'], ['quests', 'lost ledger', 'mud-quest-log'], ['west', 'Town square', 'mud-back-to-square'], ['west', 'Market', 'mud-market'], ['shop', "Odo's", 'mud-shop'], ['buy dagger', 'You buy a dagger', 'mud-bought'], ['inventory', 'dagger', 'mud-inventory']] as const) {
      await type(page, cmd);
      await expect(world(page).getByText(new RegExp(wait)).last()).toBeVisible({ timeout: 10_000 });
      await shot(label);
    }
  }

  // The BBS from the Terminal app.
  await page.goto('/terminal');
  await expect(page.locator('.xterm-rows')).toContainText('Main menu [', { timeout: 20_000 });
  await shot('terminal-main-menu');
  await page.locator('.xterm-helper-textarea').focus();
  for (const [key, expect_, label] of [['v', 'Voting booth', 'terminal-voting-booth'], ['\r', 'Main menu [', 'terminal-back'], ['i', 'Information bulletins', 'terminal-bulletins']] as const) {
    await page.keyboard.type(key === '\r' ? 'q' : key);
    await expect(page.locator('.xterm-rows')).toContainText(expect_, { timeout: 10_000 });
    await shot(label);
  }

  // An admin, with two-factor already set (a first login would walk through setting it up).
  if (!isMobile) {
    const admin = await makeAdmin(page);
    await signIn(page, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
    for (const [name, path] of [['admin-status', '/admin'], ['admin-users', '/admin/users'], ['admin-audit', '/admin/audit'], ['admin-bbs', '/admin/bbs'], ['admin-console', '/admin/console']] as const) {
      await page.goto(path).catch(() => undefined);
      await page.waitForTimeout(800);
      await shot(name);
    }
  }
});
