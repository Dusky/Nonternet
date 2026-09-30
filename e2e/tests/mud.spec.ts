import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { EVENNIA_BIN } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, signIn, totp, uniq } from '../support/helpers';

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}
const world = (page: Page) => page.getByRole('log', { name: 'What happens in the world' });
async function type(page: Page, text: string) {
  await page.getByLabel('Type a command, like look or north').fill(text);
  await page.getByLabel('Type a command, like look or north').press('Enter');
}

test.describe('the MUD', () => {
  test.skip(!EVENNIA_BIN, 'needs Evennia (set EVENNIA_BIN)');

  for (const theme of ['modern', 'amber']) {
    test(`a new player rolls a character and walks into town (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      const u = await makeUser(page, { handle: uniq('hero') });
      await signIn(page, u.handle, PASSWORD);
      await page.goto('/mud');
      await expect(world(page).getByText('You have no character yet.', { exact: false })).toBeVisible({ timeout: 20_000 });
      await type(page, 'charcreate');
      await expect(world(page).getByText('Accept and create character').last()).toBeVisible();
      await type(page, '3');
      const ready = world(page).getByText(/ is ready\./);
      await expect(ready).toBeVisible();
      const name = /^(\S+) is ready\./.exec((await ready.textContent()) ?? '')![1]!;
      await type(page, `ic ${name}`);
      await expect(world(page).getByText('Town square').last()).toBeVisible();
      await expect(world(page).locator('.mud-out').last()).not.toContainText('[1m'); // colour codes are drawn, not printed
      await type(page, 'attack me');
      await expect(world(page).getByText(/not allowed here/i).last()).toBeVisible(); // no fighting in town
      await scan(page, `the MUD (${theme})`);
    });
  }

  test('someone who has not confirmed their email is told why they cannot play', async ({ page }) => {
    const u = await makeUser(page, { verify: false });
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/mud');
    await expect(page.getByText('Confirm your email address to play the MUD.')).toBeVisible();
  });

  test('an admin sees who is playing and appoints a builder', async ({ page, browser }) => {
    const other = await browser.newContext();
    const page2 = await other.newPage();
    const u = await makeUser(page2);
    await signIn(page2, u.handle, PASSWORD);
    await page2.goto('/mud');
    await expect(world(page2).getByText('You have no character yet.', { exact: false })).toBeVisible({ timeout: 20_000 });

    const admin = await makeAdmin(page);
    await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
    await page.goto('/admin/mud');
    await expect(page.getByRole('heading', { level: 2, name: 'MUD' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: u.handle })).toBeVisible({ timeout: 15_000 });
    const builders = page.getByRole('region', { name: 'Builders' });
    await builders.getByLabel('Handle').fill(u.handle);
    await builders.getByLabel('Reason').fill('builds the swamp');
    await builders.getByRole('button', { name: 'Make builder' }).click();
    await expect(builders.getByText(`${u.handle} is now a builder.`)).toBeVisible();
    await expect(builders.getByRole('button', { name: `Stop ${u.handle} building` })).toBeVisible();
    await scan(page, 'the MUD console page');
    await other.close();
  });
});
