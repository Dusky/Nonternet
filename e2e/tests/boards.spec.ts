import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Browser, Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';

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

test.describe('boards', () => {
  test('a trusted user makes a board, posts, and another user replies and reads it', async ({ page, browser }) => {
    const owner = await makeUser(page);
    await setRole(owner.handle, 'trusted');
    await signIn(page, owner.handle, PASSWORD);
    const slug = uniq('talk');
    const name = `Talk ${slug}`;

    await page.goto('/boards');
    await page.getByRole('link', { name: 'New board' }).click();
    await page.getByLabel('Address').fill(slug);
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Description').fill('Chat about anything.');
    await page.getByRole('button', { name: 'Create board' }).click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();

    await page.getByRole('link', { name: 'New thread' }).click();
    await page.getByLabel('Subject').fill('Hello there');
    await page.getByLabel('Message').fill('First post.\n\nA second paragraph with café.');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByTestId('preview')).toHaveText('First post.\n\nA second paragraph with café.');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Hello there' })).toBeVisible();
    await expect(page.getByText('A second paragraph with café.')).toBeVisible();

    // Someone else finds the board, sees it unread, and replies.
    const other = await makeUser(page);
    const op = await signedInPage(browser, other.handle);
    await op.goto('/boards');
    const row = (p: Page) => p.getByRole('listitem').filter({ has: p.getByRole('link', { name, exact: true }) });
    await expect(row(op)).toBeVisible();
    await expect(row(op).getByText('1 unread')).toBeVisible();
    await op.getByRole('link', { name, exact: true }).click();
    await op.getByRole('link', { name: 'Hello there' }).click();
    await expect(op.getByText('First post.')).toBeVisible();
    await op.getByRole('button', { name: 'Reply' }).first().click();
    await op.getByLabel('Message').fill('Thanks for starting this.');
    await op.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(op.getByText('Thanks for starting this.')).toBeVisible();
    // Reading the thread moved the pointer: nothing is unread for them now.
    await op.goto('/boards');
    await expect(row(op)).toBeVisible();
    await expect(row(op).getByText(/unread/)).toHaveCount(0);

    // The owner sees the reply as new activity.
    await page.goto('/boards');
    await expect(row(page).getByText('1 unread')).toBeVisible();
    await op.context().close();
  });

  test('a visitor who is not signed in can read public boards and is invited to log in', async ({ page, browser }) => {
    const owner = await makeUser(page);
    await setRole(owner.handle, 'trusted');
    const op = await signedInPage(browser, owner.handle);
    const pub = uniq('open');
    const priv = uniq('closed');
    for (const [slug, visibility, name] of [[pub, 'public', `Open house ${pub}`], [priv, 'private', `Closed room ${priv}`]] as const) {
      const r = await op.request.post('/api/v1/boards', { data: { slug, name, visibility }, headers: { origin: BASE_URL } });
      expect(r.ok(), await r.text()).toBe(true);
    }
    const made = await op.request.post(`/api/v1/boards/${pub}/posts`, { data: { subject: 'Welcome', body: 'Everyone can read this.' }, headers: { origin: BASE_URL } });
    const thread = (await made.json()).id as string;
    await op.context().close();

    await page.goto('/boards');
    await expect(page.getByRole('link', { name: `Open house ${pub}` })).toBeVisible();
    await expect(page.getByText(`Closed room ${priv}`)).toHaveCount(0);
    await page.getByRole('link', { name: `Open house ${pub}` }).click();
    await page.getByRole('link', { name: 'Welcome', exact: true }).click();
    await expect(page.getByText('Everyone can read this.')).toBeVisible();
    await expect(page.getByText('Log in to post.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reply' })).toHaveCount(0);
    await page.goto(`/boards/${priv}`);
    await expect(page.getByText('No such board.')).toBeVisible();

    // The way in brings them back to the thread.
    await page.goto(`/boards/${pub}/t/${thread}`);
    await page.getByRole('link', { name: 'Log in' }).first().click();
    await expect(page).toHaveURL(new RegExp(`return_to=${encodeURIComponent(`/boards/${pub}/t/${thread}`)}`));
  });

  test('searches, and moves between threads with the keyboard', async ({ page, browser }) => {
    const owner = await makeUser(page);
    await setRole(owner.handle, 'trusted');
    await signIn(page, owner.handle, PASSWORD);
    const slug = uniq('keys');
    const post = (subject: string, body: string) => page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject, body }, headers: { origin: BASE_URL } });
    expect((await page.request.post('/api/v1/boards', { data: { slug, name: 'Keys', visibility: 'public' }, headers: { origin: BASE_URL } })).ok()).toBe(true);
    const word = uniq('zuc'); // unique, so posts from other runs never match
    await post('Alpha', `about ${word} growing`);
    await post('Beta', 'nothing to see');
    await post('Gamma', 'more of the same');

    await page.goto('/boards/search');
    await page.getByLabel('Search for').fill(word);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Alpha' })).toBeVisible();
    await expect(page.locator('mark')).toHaveText(word);

    await page.goto(`/boards/${slug}`);
    await expect(page.getByRole('link', { name: 'Gamma' })).toBeVisible();
    await page.keyboard.press('j');
    await expect(page.getByRole('link', { name: 'Gamma' })).toBeFocused();
    await page.keyboard.press('j');
    await expect(page.getByRole('link', { name: 'Beta' })).toBeFocused();
    await page.keyboard.press('k');
    await expect(page.getByRole('link', { name: 'Gamma' })).toBeFocused();
  });

  test('owner archives a board and it becomes read-only', async ({ page }) => {
    const owner = await makeUser(page);
    await setRole(owner.handle, 'trusted');
    await signIn(page, owner.handle, PASSWORD);
    const slug = uniq('old');
    await page.request.post('/api/v1/boards', { data: { slug, name: 'Old news', visibility: 'public' }, headers: { origin: BASE_URL } });
    await page.goto(`/boards/${slug}/settings`);
    await page.getByLabel('Archive this board').click();
    await expect(page.getByLabel('Archive this board')).toBeChecked();
    await page.goto(`/boards/${slug}`);
    await expect(page.getByText('This board is archived. It is read-only.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'New thread' })).toHaveCount(0);
  });

  for (const theme of ['modern', 'amber'] as const) {
    test(`accessibility of the boards screens (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      const owner = await makeUser(page);
      await setRole(owner.handle, 'trusted');
      await signIn(page, owner.handle, PASSWORD);
      const slug = uniq('a11y');
      await page.request.post('/api/v1/boards', { data: { slug, name: 'Accessible', visibility: 'private' }, headers: { origin: BASE_URL } });
      const t = await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Scan me', body: 'Some text here.' }, headers: { origin: BASE_URL } });
      const id = (await t.json()).id;
      await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'A reply.', reply_to: id }, headers: { origin: BASE_URL } });
      for (const path of ['/boards', '/boards/new', '/boards/search', `/boards/${slug}`, `/boards/${slug}/new`, `/boards/${slug}/settings`, `/boards/${slug}/t/${id}`]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: 'Boards' })).toBeVisible();
        await expect(page.getByText('Loading')).toHaveCount(0);
        await scan(page, `${path} (${theme})`);
      }
      await page.goto(`/boards/${slug}/new`);
      await page.getByLabel('Message').fill('Preview this');
      await page.getByRole('button', { name: 'Preview' }).click();
      await expect(page.getByTestId('preview')).toBeVisible();
      await scan(page, `the composer with a preview (${theme})`);
    });
  }
});
