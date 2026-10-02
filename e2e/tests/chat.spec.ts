import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { BASE_URL, ERGO_BIN } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, signIn, totp, uniq } from '../support/helpers';

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}
const log = (page: Page, channel: string) => page.getByRole('log', { name: `Messages in ${channel}` });

test.describe('chat', () => {
  test.skip(!ERGO_BIN, 'needs an ergo binary (set ERGO_BIN)');

  test('two people talk in the lobby: history, mentions, /me and the people list', async ({ page, browser }) => {
    const a = await makeUser(page, { handle: uniq('ann') });
    await signIn(page, a.handle, PASSWORD);
    await page.goto('/chat');
    await expect(page.getByRole('heading', { level: 2, name: '#lobby' })).toBeVisible({ timeout: 15_000 });
    const word = uniq('hello');
    await page.getByLabel('Message #lobby').fill(`${word} from ann`);
    await page.getByLabel('Message #lobby').press('Enter');
    await expect(log(page, '#lobby').getByText(`${word} from ann`)).toBeVisible();

    // Someone else arrives later and sees what was said before they came (server history).
    const other = await browser.newContext();
    const page2 = await other.newPage();
    const b = await makeUser(page2, { handle: uniq('bob') });
    await signIn(page2, b.handle, PASSWORD);
    await page2.goto('/chat');
    await expect(log(page2, '#lobby').getByText(`${word} from ann`)).toBeVisible({ timeout: 15_000 });
    await page2.getByLabel('Message #lobby').fill(`${a.handle}: welcome!`);
    await page2.getByLabel('Message #lobby').press('Enter');
    await page2.getByLabel('Message #lobby').fill(`/me waves at ${word}`);
    await page2.getByLabel('Message #lobby').press('Enter');

    await expect(log(page, '#lobby').locator('.is-mention').getByText(`${a.handle}: welcome!`)).toBeVisible();
    await expect(log(page, '#lobby').getByText(`waves at ${word}`)).toHaveCount(1);
    const people = page.getByRole('complementary', { name: /here$/ });
    if (await page.getByRole('button', { name: /here$/ }).isVisible()) await page.getByRole('button', { name: /here$/ }).click(); // on a phone the list folds away
    await expect(people.getByText(b.handle, { exact: true })).toBeVisible();
    await scan(page, 'the Chat app');
    await other.close();
  });

  test('Tab finishes a nick, typing shows to the other person, a nick opens a private chat, /help lists commands', async ({ page, browser }) => {
    const a = await makeUser(page, { handle: uniq('ann') });
    await signIn(page, a.handle, PASSWORD);
    await page.goto('/chat');
    await expect(page.getByRole('heading', { level: 2, name: '#lobby' })).toBeVisible({ timeout: 15_000 });
    const other = await browser.newContext();
    const page2 = await other.newPage();
    const b = await makeUser(page2, { handle: uniq('bob') });
    await signIn(page2, b.handle, PASSWORD);
    await page2.goto('/chat');
    await expect(page2.getByRole('heading', { level: 2, name: '#lobby' })).toBeVisible({ timeout: 15_000 });
    const box = page.getByLabel('Message #lobby');
    await expect(page.getByRole('complementary', { name: /here$/ }).or(page.getByRole('button', { name: /here$/ })).first()).toBeVisible();
    await box.fill(b.handle.slice(0, 5));
    await box.press('Tab');
    await expect(box).toHaveValue(`${b.handle}: `);
    // Typing is a courtesy: ann types, bob may see it.
    await box.fill('typing something');
    await expect(page2.getByText(`${a.handle} is typing…`)).toBeVisible({ timeout: 8000 });
    await box.fill('/help');
    await box.press('Enter');
    await expect(log(page, '#lobby').getByText(/Commands: \/join/)).toBeVisible();
    // Bob says something; ann clicks his name to talk privately.
    await page2.getByLabel('Message #lobby').fill('over here');
    await page2.getByLabel('Message #lobby').press('Enter');
    await log(page, '#lobby').getByRole('button', { name: new RegExp(`^${b.handle}`) }).first().click();
    await expect(page.getByRole('heading', { level: 2, name: b.handle })).toBeVisible();
    await other.close();
  });

  test('a word you pick counts as a mention, the person menu ignores someone, and a pasted block is sent line by line', async ({ page, browser }) => {
    const a = await makeUser(page, { handle: uniq('ann') });
    await signIn(page, a.handle, PASSWORD);
    // A highlight word is kept on the account, in Settings, Chat.
    const word = uniq('banana');
    await page.goto('/settings/chat');
    await page.getByLabel('Words that count as a mention').fill(word);
    await page.getByRole('button', { name: 'Save words' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await page.goto('/chat');
    await expect(page.getByRole('heading', { level: 2, name: '#lobby' })).toBeVisible({ timeout: 15_000 });
    const other = await browser.newContext();
    const page2 = await other.newPage();
    const b = await makeUser(page2, { handle: uniq('bob') });
    await signIn(page2, b.handle, PASSWORD);
    await page2.goto('/chat');
    const box2 = page2.getByLabel('Message #lobby');
    await expect(box2).toBeVisible({ timeout: 15_000 });
    await box2.fill(`who wants a ${word}?`);
    await box2.press('Enter');
    await expect(log(page, '#lobby').locator('.is-mention').getByText(`who wants a ${word}?`)).toBeVisible({ timeout: 10_000 });

    // Ignore bob from the people list; his next line never shows.
    if (await page.getByRole('button', { name: /here$/ }).isVisible()) await page.getByRole('button', { name: /here$/ }).click();
    await page.getByRole('complementary', { name: /here$/ }).getByRole('button', { name: new RegExp(`^${b.handle}`) }).click();
    await page.getByRole('menuitem', { name: 'Ignore' }).click();
    const hidden = uniq('hidden');
    await box2.fill(`you should not see ${hidden}`);
    await box2.press('Enter');
    await box2.fill(`/me is ignored ${hidden}`);
    await box2.press('Enter');
    // Once the server has echoed bob's lines back to him, it has sent them to ann too.
    await expect(log(page2, '#lobby').getByText(`is ignored ${hidden}`)).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    const box = page.getByLabel('Message #lobby');
    await box.fill('/ignore');
    await box.press('Enter');
    await expect(log(page, '#lobby').getByText(b.handle, { exact: true }).last()).toBeVisible();
    await expect(log(page, '#lobby').getByText(`you should not see ${hidden}`)).toHaveCount(0);
    await box.fill(`/unignore ${b.handle}`);
    await box.press('Enter');
    await expect(log(page, '#lobby').getByText('You will see their messages again.')).toBeVisible();

    // Pasting three lines asks first, then sends three messages.
    await box.focus();
    const tag = uniq('line');
    await page.evaluate((tag) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', `first ${tag}\nsecond ${tag}\nthird ${tag}`);
      document.getElementById('chat-input')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, tag);
    await page.getByRole('button', { name: 'Send them' }).click();
    for (const l of [`first ${tag}`, `second ${tag}`, `third ${tag}`]) await expect(log(page2, '#lobby').getByText(l)).toBeVisible({ timeout: 10_000 });
    await other.close();
  });

  test('joins another channel, and says plainly when a command is not known', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/chat');
    await expect(page.getByRole('heading', { level: 2, name: '#lobby' })).toBeVisible({ timeout: 15_000 });
    const channels = page.getByRole('navigation', { name: 'Channels' });
    await channels.getByRole('button', { name: '#help' }).click(); // listed under "Channels on the site"
    await expect(page.getByRole('heading', { level: 2, name: '#help' })).toBeVisible();
    await page.getByLabel('Message #help').fill('/frobnicate');
    await page.getByLabel('Message #help').press('Enter');
    await expect(log(page, '#help').getByText('Unknown command. Type /help to see them.')).toBeVisible();
    await page.getByRole('button', { name: 'Leave' }).click();
    await expect(channels.getByRole('button', { name: '#help' })).toBeVisible(); // back in the site list
  });

  test('someone who has not confirmed their email is told why they cannot chat', async ({ page }) => {
    const u = await makeUser(page, { verify: false });
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/chat');
    await expect(page.getByText('Confirm your email address to use chat.')).toBeVisible();
  });

  test('a terminal password is set in Settings, and the Chat app explains native clients', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/settings/terminal');
    await expect(page.getByText('You have no terminal password yet.', { exact: false })).toBeVisible();
    await page.getByLabel('Current password').fill(PASSWORD);
    await page.getByLabel('New terminal password').fill('a different secret');
    await page.getByRole('button', { name: 'Set terminal password' }).click();
    await expect(page.getByText('Terminal password saved.')).toBeVisible();
    await expect(page.getByText(/You set a terminal password/)).toBeVisible();
    await scan(page, 'the terminal password page');
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Use your own IRC client' }).click();
    await expect(page.getByText(/Connect to 127\.0\.0\.1 on port \d+ with TLS/)).toBeVisible();
  });

  test('an admin sees IRC in the console and can post an announcement to the lobby', async ({ page, browser }) => {
    const admin = await makeAdmin(page);
    await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
    const other = await browser.newContext();
    const page2 = await other.newPage();
    const u = await makeUser(page2);
    await signIn(page2, u.handle, PASSWORD);
    await page2.goto('/chat');
    await expect(page2.getByRole('heading', { level: 2, name: '#lobby' })).toBeVisible({ timeout: 15_000 });

    await page.goto('/admin/irc');
    await expect(page.getByRole('heading', { level: 2, name: 'IRC' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Connected now' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('cell', { name: '#lobby' }).or(page.getByRole('rowheader', { name: '#lobby' }))).toBeVisible();
    await scan(page, 'the IRC console page');

    const title = uniq('Heads up');
    await page.goto('/admin/announcements');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Also post it in #lobby on IRC when it starts').check();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(log(page2, '#lobby').getByText(title)).toBeVisible({ timeout: 15_000 });
    await other.close();
    // End it again: the test database is shared, and a live banner would sit over every later test's page.
    const list = await (await page.request.get('/api/v1/admin/announcements')).json() as { announcements: { id: string; title: string }[] };
    const made = list.announcements.find((a) => a.title === title)!;
    expect((await page.request.delete(`/api/v1/admin/announcements/${made.id}`, { headers: { origin: BASE_URL } })).status()).toBe(204);
  });

  test('opening Chat from the desktop signs you in with no prompt (terminal theme, accessibility)', async ({ page, isMobile }) => {
    await page.addInitScript(() => localStorage.setItem('ui:theme', 'terminal'));
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/');
    let scope;
    if (isMobile) { await page.getByRole('link', { name: 'Chat' }).click(); scope = page.locator('main'); }
    else { await page.getByRole('button', { name: 'Open Chat' }).click(); scope = page.getByRole('dialog', { name: 'Chat window' }); }
    await expect(scope.getByRole('heading', { level: 2, name: '#lobby' })).toBeVisible({ timeout: 15_000 });
    await expect(scope.getByLabel('Message #lobby')).toBeVisible();
    await scan(page, 'the Chat app (terminal)');
  });
});
