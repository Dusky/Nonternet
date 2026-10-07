import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Readable text in posts and mail (docs/23, E1): the wiki's safe formatting, line breaks kept, links that leave the
// site safely, @mentions that go to the person, and quoting the text you picked.
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test('a post shows its formatting, keeps its lines, and quoting picks just the selected text', async ({ page }) => {
  const friend = await makeUser(page);
  const owner = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  await signIn(page, owner.handle, PASSWORD);
  const slug = uniq('fmt');
  expect((await page.request.post('/api/v1/boards', { data: { slug, name: 'Formatting', visibility: 'public' }, headers: h })).ok()).toBe(true);
  const body = [
    'Line one',
    'Line two with **bold** and *soft*',
    '',
    '- first',
    '- second',
    '',
    '> a quote',
    '',
    `See https://example.net/page and say hi to @${friend.handle}`,
    '',
    '```',
    '  /\\_/\\',
    '```',
    '',
    '[sneaky](javascript:alert(1))',
  ].join('\n');
  const r = await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Formatting test', body }, headers: h });
  expect(r.ok()).toBe(true);
  const id = (await r.json()).id as string;

  await page.goto(`/boards/${slug}/t/${id}`);
  const post = page.locator(`[data-post-body="${id}"]`);
  await expect(post.locator('strong')).toHaveText('bold');
  await expect(post.locator('em')).toHaveText('soft');
  await expect(post.locator('li')).toHaveText(['first', 'second']);
  await expect(post.locator('blockquote')).toHaveText('a quote');
  await expect(post.locator('pre code')).toContainText('/\\_/\\');
  const link = post.getByRole('link', { name: 'https://example.net/page' });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(post.getByRole('link', { name: `@${friend.handle}` })).toBeVisible();
  await expect(post.getByRole('link', { name: 'sneaky' })).toHaveCount(0); // a javascript: address stays text
  // The two lines stay two lines.
  expect(await post.locator('p').first().evaluate((p) => (p as HTMLElement).innerText)).toBe('Line one\nLine two with bold and soft');
  await scan(page, 'a formatted post');

  // Select "Line two" in the post, then reply: only that is quoted.
  await post.locator('p').first().evaluate((p) => {
    const text = p.firstChild!;
    const range = document.createRange();
    range.setStart(text, 9);
    range.setEnd(text, 17);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  const box = page.locator('#compose-body');
  await expect(box).toHaveValue(/^[A-Z0-9]{1,3}> Line two\n/);
  await expect(box).not.toHaveValue(/first/);

  // The preview shows it the way the web will, with the terminal view a click away.
  await box.press('End');
  await box.pressSequentially('\nAgreed, **very** much.');
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.locator('.preview');
  await expect(preview.locator('blockquote')).toHaveText('Line two');
  await expect(preview.locator('strong')).toHaveText('very');
  await preview.getByText('How it looks in a terminal').click();
  await expect(page.getByTestId('preview')).toContainText('Agreed, **very** much.');
});

test('mail shows the same formatting', async ({ page, browser }) => {
  const to = await makeUser(page);
  const from = await makeUser(page);
  await signIn(page, from.handle, PASSWORD);
  const subject = uniq('Plans ');
  expect((await page.request.post('/api/v1/mail', { data: { to: [to.handle], subject, body: 'Bring **snacks**\nand a `cable`' }, headers: h })).ok()).toBe(true);
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const p2 = await ctx.newPage();
  await signIn(p2, to.handle, PASSWORD);
  await p2.goto('/mail');
  await p2.getByRole('link', { name: subject }).click();
  await expect(p2.locator('.rich-text strong')).toHaveText('snacks');
  await expect(p2.locator('.rich-text code')).toHaveText('cable');
  await scan(p2, 'a formatted message');
  await ctx.close();
});
