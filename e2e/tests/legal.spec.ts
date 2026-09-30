import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeAdmin, signIn, totp, uniq } from '../support/helpers';

test.describe('legal pages and takedown requests', () => {
  test('a signed-out visitor reads a page and sends a request; an admin edits a page and answers the request', async ({ page }) => {
    const who = uniq('Photographer');
    await page.goto('/legal/takedown');
    await expect(page.getByRole('heading', { level: 1, name: 'Takedown requests' })).toBeVisible();
    await expect(page.getByText('This page is placeholder text.')).toBeVisible();
    await page.getByLabel('Address of the page or post').fill('https://example.test/somebody/');
    await page.getByLabel('What is wrong with it?').fill('This page copies my photographs.');
    await page.getByLabel('Your name').fill(who);
    await page.getByLabel('Your email').fill(`${who}@example.org`);
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('You need to confirm', { exact: false }).or(page.getByText('Please confirm the statement'))).toBeVisible();
    await page.getByLabel(/I am telling the truth/).check();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText(/Thank you\. An admin will read your request/)).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);

    const admin = await makeAdmin(page);
    await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
    await page.goto('/admin/legal');
    const card = page.locator('li.panel').filter({ hasText: who });
    await expect(card).toBeVisible();
    await card.getByLabel('Note for the record').fill('Removed the page.');
    await card.getByRole('button', { name: 'Acted on it' }).click();
    await expect(card.getByText('Acted on', { exact: true })).toBeVisible();

    const editor = page.getByRole('region', { name: /^Terms of (service|use)$/ });
    await editor.getByRole('button', { name: /^Edit Terms of/ }).click();
    await editor.getByLabel('Title').fill('Terms of use');
    await editor.getByLabel('Text').fill('## The rules\n\nBe kind, and do not post what is not yours to post.');
    await editor.getByLabel('Reason for the change').fill('first real text');
    await editor.getByRole('button', { name: 'Save new version' }).click();
    await expect(editor.getByText(/Saved as version \d+\./)).toBeVisible();

    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'The rules' })).toBeVisible();
    await expect(page.getByText('This page is placeholder text.')).toHaveCount(0);
    // (the shared test database keeps earlier runs' edits, so the terms page may not start as a placeholder)
  });
});
