import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Browser, Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, signIn, totp, confirmDialog } from '../support/helpers';

async function signedInPage(browser: Browser, handle: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await signIn(page, handle, PASSWORD);
  return page;
}

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test.describe('mail', () => {
  test('someone writes from a profile, the other replies, a third joins, and a message is reported', async ({ page, browser }) => {
    const a = await makeUser(page);
    const b = await makeUser(page);
    const c = await makeUser(page);
    await signIn(page, a.handle, PASSWORD);

    // Start from b's profile.
    await page.goto(`/people/${b.handle}`);
    await page.getByRole('link', { name: 'Send mail' }).click();
    await expect(page.getByLabel('To', { exact: true })).toHaveValue(b.handle);
    await page.getByLabel('Subject').fill('Board games');
    await page.getByLabel('Message').fill('Want to play on Friday?');
    await scan(page, 'the compose screen');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Board games', exact: true })).toBeVisible();
    await expect(page.getByText('Want to play on Friday?')).toBeVisible();

    // b sees it unread, in the taskbar and the inbox, and replies.
    const bp = await signedInPage(browser, b.handle);
    await expect(bp.getByRole('button', { name: 'Mail, 1 unread' })).toBeVisible();
    await bp.goto('/mail');
    const row = bp.getByRole('listitem').filter({ has: bp.getByRole('link', { name: 'Board games' }) });
    await expect(row.getByText('new', { exact: true })).toBeVisible();
    await scan(bp, 'the inbox');
    await bp.getByRole('link', { name: 'Board games' }).click();
    await bp.getByLabel('Reply').fill('Yes! Bring snacks.');
    await bp.getByRole('button', { name: 'Send reply' }).click();
    await expect(bp.getByText('Yes! Bring snacks.')).toBeVisible();
    await bp.getByText('People and leaving').click();
    await bp.getByLabel('Add someone').fill(c.handle);
    await bp.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(bp.getByText(`${c.handle} joined`)).toBeVisible();
    await scan(bp, 'a conversation');

    // c sees only what came after they joined.
    const cp = await signedInPage(browser, c.handle);
    await cp.goto('/mail');
    await cp.getByRole('link', { name: 'Board games' }).click();
    await expect(cp.getByText(`${c.handle} joined`)).toBeVisible();
    await expect(cp.getByText('Want to play on Friday?')).toHaveCount(0);

    // a reports b's reply; the admin sees just that message.
    await page.goto('/mail');
    await page.getByRole('link', { name: 'Board games' }).click();
    const reply = page.getByRole('article').filter({ hasText: 'Yes! Bring snacks.' });
    await reply.getByRole('button', { name: 'Report' }).click();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('Thanks. The admins have your report.')).toBeVisible();

    const admin = await makeAdmin(page);
    const ap = await browser.newContext({ baseURL: BASE_URL }).then((x) => x.newPage());
    await signIn(ap, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
    await ap.goto('/admin/reports');
    const rep = ap.getByRole('listitem').filter({ hasText: 'Yes! Bring snacks.' });
    await expect(rep.getByText(`Private message from ${b.handle}. Only this message is shown.`)).toBeVisible();
    await expect(ap.getByText('Want to play on Friday?')).toHaveCount(0);
  });

  test('blocking from a profile stops mail, and the Blocked tab lists and lifts it', async ({ page, browser }) => {
    const a = await makeUser(page);
    const b = await makeUser(page);
    await signIn(page, a.handle, PASSWORD);
    await page.goto(`/people/${b.handle}`);
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await confirmDialog(page, 'Block');
    await expect(page.getByText('You have blocked this person.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Send mail' })).toHaveCount(0);

    const bp = await signedInPage(browser, b.handle);
    await bp.goto(`/mail/new/${a.handle}`);
    await bp.getByLabel('Subject').fill('Hi');
    await bp.getByLabel('Message').fill('Hello?');
    await bp.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(bp.getByRole('alert')).toBeVisible();

    await page.goto('/settings/blocked');
    await expect(page.getByRole('heading', { name: 'Blocked people' })).toBeVisible();
    await scan(page, 'the blocked people list');
    await page.getByRole('button', { name: `Unblock ${b.handle}` }).click();
    await expect(page.getByText('You have not blocked anyone.')).toBeVisible();
  });
});
