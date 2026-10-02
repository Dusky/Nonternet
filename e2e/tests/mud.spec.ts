import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { BASE_URL, EVENNIA_BIN } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, totp, uniq } from '../support/helpers';

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

  for (const theme of ['webring', 'terminal']) {
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

  test('the client: gauges, map and exits, an alias, a trigger that colours and captures, a button, kept on the account', async ({ page, isMobile }) => {
    const u = await makeUser(page, { handle: uniq('rogue') });
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

    // The side panel hears from the game: health, the room, the ways out.
    const side = page.getByRole('complementary', { name: 'Your character and surroundings' });
    await expect(side.getByRole('meter', { name: /^Health: \d+ of \d+$/ })).toBeVisible({ timeout: 10_000 });
    await expect(side.getByText('Level 1')).toBeVisible();
    await expect(side.getByRole('heading', { name: 'Map: Town' })).toBeVisible();
    await expect(side.locator('.mud-here')).toHaveText('Town square');
    // Clicking a way out walks.
    await side.getByRole('list', { name: /Ways out/ }).getByRole('button', { name: 'east' }).click();
    await expect(side.locator('.mud-here')).toHaveText('The tavern');
    await expect(side.getByRole('img', { name: /You know 2 rooms in this area/ })).toBeVisible();

    // Rules: an alias, a trigger, a button.
    await page.getByRole('button', { name: 'Client rules' }).click();
    const ed = page.getByRole('region', { name: 'Client rules' });
    await ed.getByRole('button', { name: 'Add one' }).click();
    await ed.getByLabel('When you type').fill('ww');
    await ed.getByLabel('Send', { exact: true }).fill('west;look');
    await ed.getByRole('button', { name: 'Save' }).click();
    await expect(ed.getByText('west;look')).toBeVisible();

    await ed.getByRole('tab', { name: 'Triggers' }).click();
    await ed.getByRole('button', { name: 'Add one' }).click();
    await ed.getByLabel('When a line').fill('Town square');
    await ed.getByLabel('Colour', { exact: true }).selectOption('green');
    await ed.getByRole('button', { name: 'Add an action' }).click();
    await ed.getByLabel('Action 2').selectOption('capture');
    await ed.getByLabel('Window name').fill('Places');
    await ed.getByRole('button', { name: 'Save' }).click();
    await expect(ed.getByText(/colour green, copy to "Places"/)).toBeVisible();

    await ed.getByRole('tab', { name: 'Buttons' }).click();
    await ed.getByRole('button', { name: 'Add one' }).click();
    await ed.getByLabel('Label').fill('Look');
    await ed.getByLabel('Send', { exact: true }).fill('look');
    await ed.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await type(page, 'ww');
    await expect(world(page).getByText('ww  → west; look')).toBeVisible();
    await expect(world(page).locator('.mud-hl-green').filter({ hasText: 'Town square' }).first()).toBeVisible();
    await expect(side.getByRole('log', { name: 'Places' }).getByText('Town square').first()).toBeVisible();
    await page.getByRole('group', { name: 'Your buttons' }).getByRole('button', { name: 'Look' }).click();
    await expect(world(page).locator('.mud-you').filter({ hasText: /^> look$/ }).first()).toBeVisible();

    // Speedwalk, and the history comes back after a reload (it is on the account).
    await type(page, '#e');
    await expect(side.locator('.mud-here')).toHaveText('The tavern');
    await page.waitForTimeout(1500); // the settings save a moment after a change
    await page.reload();
    await expect(page.getByLabel('Type a command, like look or north')).toBeEnabled({ timeout: 20_000 });
    await page.getByLabel('Type a command, like look or north').press('ArrowUp');
    await expect(page.getByLabel('Type a command, like look or north')).toHaveValue('#e');
    const saved = await (await page.request.get('/api/v1/me/client-settings/mud')).json();
    expect(saved.settings.aliases[0]).toMatchObject({ pattern: 'ww', send: 'west;look' });
    expect(saved.settings.triggers[0].actions).toEqual([{ type: 'highlight', colour: 'green', line: false }, { type: 'capture', window: 'Places' }]);
    if (!isMobile) await scan(page, 'the MUD client with its panel');
    await page.getByRole('button', { name: 'Client rules' }).click();
    await scan(page, 'the MUD client rules');
  });

  test('a character made in the MUD shows on the profile and, featured, beside posts on the boards', async ({ page }) => {
    const u = await makeUser(page, { handle: uniq('bard') });
    await setRole(u.handle, 'trusted'); // to start a board
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/mud');
    await expect(world(page).getByText('You have no character yet.', { exact: false })).toBeVisible({ timeout: 20_000 });
    await type(page, 'charcreate');
    await expect(world(page).getByText('Accept and create character').last()).toBeVisible();
    await type(page, '3');
    const ready = world(page).getByText(/ is ready\./);
    await expect(ready).toBeVisible();
    const name = /^(\S+) is ready\./.exec((await ready.textContent()) ?? '')![1]!;

    // The MUD tells the site at once; pick it as the featured character.
    await expect(async () => {
      await page.goto('/settings/profile');
      await expect(page.getByLabel('Character to show')).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await page.getByLabel('Character to show').selectOption({ label: `${name}, level 1` });
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto(`/people/${u.handle}`);
    const card = page.getByRole('listitem', { name: `${name}, level 1` });
    await expect(card).toBeVisible();
    await expect(card.getByText('featured')).toBeVisible();
    await expect(card.getByText('STR')).toBeVisible();
    await scan(page, 'a profile with a character');

    const slug = uniq('tales');
    const res = await page.request.post('/api/v1/boards', { data: { slug, name: 'Tales', visibility: 'public' }, headers: { origin: BASE_URL } });
    expect(res.ok(), await res.text()).toBe(true);
    const post = await (await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'A song', body: 'La la la.' }, headers: { origin: BASE_URL } })).json();
    await page.goto(`/boards/${slug}/t/${post.id}`);
    await expect(page.getByText(`as ${name}, level 1`)).toBeVisible();
    // Signed out, the author still links to their profile.
    await page.context().clearCookies();
    await page.goto(`/boards/${slug}/t/${post.id}`);
    await page.getByRole('link', { name: u.handle }).click();
    await expect(page.getByRole('heading', { level: 2, name: u.handle })).toBeVisible();
    await expect(page.getByRole('listitem', { name: `${name}, level 1` })).toBeVisible();
  });

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
