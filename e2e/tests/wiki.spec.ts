import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// The wiki (docs/20). Each test works in a fresh ring's wiki or on pages with unique names, because the site wiki is
// shared by every test in the run.
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

async function trusted(page: Page) {
  const u = await makeUser(page);
  await setRole(u.handle, 'trusted');
  await signIn(page, u.handle, PASSWORD);
  return u;
}

// A ring with its wiki switched on, through the ring page as an op would.
async function ringWithWiki(page: Page) {
  const slug = uniq('wr');
  expect((await page.request.post('/api/v1/rings', { data: { slug, name: `Ring ${slug}` }, headers: h })).ok()).toBe(true);
  await page.goto(`/rings/${slug}`);
  await page.getByRole('tab', { name: 'Details' }).click();
  await page.getByRole('switch', { name: 'This ring has a wiki' }).check();
  await expect(page.getByRole('link', { name: 'Wiki', exact: true })).toBeVisible();
  return slug;
}

test('start a wiki, follow a link to a missing page, write it, and see the history and what changed', async ({ page, isMobile }) => {
  await trusted(page);
  const ring = await ringWithWiki(page);
  await page.getByRole('link', { name: 'Wiki', exact: true }).click();
  await expect(page.getByText('This wiki has no pages yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Start the first page' }).click();

  const text = page.getByLabel('Page text');
  // The formatting help is reachable on every width, not only where the Write/Preview tabs show.
  await page.getByRole('button', { name: /page formatting/i }).click();
  await expect(page.getByText('Pages are plain text with a little formatting.')).toBeVisible();
  await page.keyboard.press('Escape');
  // The shortcut note is for keyboards, and says saves in an edit form.
  if (isMobile) await expect(page.getByText(/Ctrl\+Enter/)).toBeHidden();
  else await expect(page.getByText('Ctrl+Enter saves.')).toBeVisible();
  await text.fill('# Welcome\n\nThis is our ring. Read the [[Patch Notes]] first.\n\n- one\n- two');
  // The preview follows the text, and a page that doesn't exist yet is marked as such.
  // On a phone the preview is a tab of its own.
  const tab = page.getByRole('button', { name: 'Preview', exact: true });
  if (await tab.isVisible()) await tab.click();
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(preview.getByRole('link', { name: /Patch Notes \(no page yet\)/ })).toBeVisible();
  await page.getByLabel('What you changed').fill('First version');
  await scan(page, 'the wiki editor');
  await page.getByRole('button', { name: 'Save page' }).click();

  await expect(page.getByRole('heading', { name: 'Home', level: 2 })).toBeVisible();
  await page.getByRole('link', { name: /Patch Notes/ }).click();
  await expect(page.getByText('There is no page called “Patch notes” yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Start this page' }).click();
  await page.getByLabel('Page text').fill('Version one of the notes.');
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByRole('article').getByText('Version one of the notes.')).toBeVisible();

  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Page text').fill('Version two of the notes.\nWith a second line.');
  await page.getByLabel('What you changed').fill('Second version');
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByRole('article').getByText('Version two of the notes.')).toBeVisible();

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('link', { name: 'Revision 2' })).toBeVisible();
  await expect(page.getByText('Second version')).toBeVisible();
  await page.getByRole('link', { name: 'Compare with the one before' }).first().click();
  await expect(page.getByText('2 lines added, 1 removed')).toBeVisible();
  await expect(page.locator('.wiki-diff .is-removed')).toContainText('Version one of the notes.');
  await scan(page, 'a wiki comparison');

  await page.getByRole('link', { name: 'Back to the history' }).click();
  await page.getByRole('button', { name: 'Put this version back' }).click();
  await expect(page.getByText('Put back as revision 3.')).toBeVisible();
  await page.goto(`/wiki/r/${ring}/p/patch-notes`);
  await expect(page.getByRole('article').getByText('Version one of the notes.')).toBeVisible();
  await scan(page, 'a wiki page');
});

test('a save that started from an older revision shows both texts to merge, and loses nothing', async ({ page }) => {
  await trusted(page);
  const title = `Conflict ${uniq('c')}`;
  const slug = title.toLowerCase().replace(/\s+/g, '-');
  expect((await page.request.put(`/api/v1/wiki/site/pages/${slug}`, { data: { title, body: 'The original line.', base_revision: 0 }, headers: h })).ok()).toBe(true);
  await page.goto(`/wiki/p/${slug}/edit`);
  await page.getByLabel('Page text').fill('My careful rewrite.');
  // Meanwhile, someone else saves.
  expect((await page.request.put(`/api/v1/wiki/site/pages/${slug}`, { data: { title, body: 'Their quick fix.', base_revision: 1 }, headers: h })).ok()).toBe(true);
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByRole('heading', { name: 'Someone saved this page while you were editing' })).toBeVisible();
  await expect(page.locator('.wiki-conflict pre')).toHaveText('Their quick fix.');
  await expect(page.getByLabel('Page text')).toHaveValue('My careful rewrite.'); // still mine
  await page.getByLabel('Page text').fill('Their quick fix.\nMy careful rewrite.');
  await page.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByRole('article').getByText('My careful rewrite.')).toBeVisible();
  const p = await (await page.request.get(`/api/v1/wiki/site/pages/${slug}`)).json();
  expect(p.revision).toBe(3);
});

test('people who are not trusted read but cannot edit, and search finds pages', async ({ page, browser }) => {
  await trusted(page);
  const word = uniq('zq');
  const title = `Searchable ${word}`;
  const slug = title.toLowerCase().replace(/\s+/g, '-');
  expect((await page.request.put(`/api/v1/wiki/site/pages/${slug}`, { data: { title, body: `A page about ${word} and nothing else.`, base_revision: 0 }, headers: h })).ok()).toBe(true);

  const other = await browser.newContext({ baseURL: BASE_URL });
  const reader = await other.newPage();
  const u = await makeUser(reader);
  await signIn(reader, u.handle, PASSWORD);
  await reader.goto(`/wiki/p/${slug}`);
  await expect(reader.getByRole('heading', { name: title })).toBeVisible();
  await expect(reader.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(reader.getByText('Trusted people can edit pages here.')).toBeVisible(); // and they are told who can
  await reader.goto('/wiki/search');
  await reader.getByLabel('Search this wiki').fill(word);
  await reader.getByRole('button', { name: 'Search' }).last().click();
  await expect(reader.getByRole('link', { name: title })).toBeVisible();
  await expect(reader.locator('mark')).toHaveText(word);
  await other.close();
});

test('an admin can fill the empty site wiki with the starter help pages; a trusted person cannot', async ({ page }, info) => {
  // The site wiki is shared by the whole run, so this runs once (desktop) to see it empty.
  test.skip(info.project.name !== 'desktop');
  await trusted(page);
  await page.goto('/wiki');
  await expect(page.getByText('This wiki has no pages yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add the starter help pages' })).toHaveCount(0);
  await page.context().clearCookies();

  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
  await page.goto('/wiki');
  await page.getByRole('button', { name: 'Add the starter help pages' }).click();
  await expect(page.getByText('Added 6 help pages.', { exact: false })).toBeVisible();
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { name: /^Welcome to / })).toBeVisible();
  await article.getByRole('link', { name: 'Connecting' }).click();
  await expect(page.getByRole('article').getByText('ssh -p', { exact: false })).toBeVisible();
  await scan(page, 'a starter page');
});

test('a new page by title, contents for a long page, live changes, and moderators find hidden pages to bring back', async ({ page }) => {
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
  const title = `Garden Notes ${uniq('g')}`;
  const slug = title.toLowerCase().replace(/\s+/g, '-');
  await page.goto('/wiki/pages');
  await page.getByPlaceholder('Title of a new page').fill(title);
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title); // the capitals typed, not ones guessed from the address
  await page.getByLabel('Page text').fill('# Soil\n\nDig.\n\n# Seeds\n\nSow.\n\n## Watering\n\nOften.');
  await page.getByRole('button', { name: 'Save page' }).click();

  // Three headings or more: a contents list that jumps to each.
  const contents = page.getByRole('navigation', { name: 'Contents' });
  await expect(contents.getByRole('link')).toHaveText(['Soil', 'Seeds', 'Watering']);
  await contents.getByRole('link', { name: 'Watering' }).click();
  await expect(page.getByRole('heading', { name: 'Watering' })).toBeFocused();

  // Someone saves meanwhile: the open page shows it without a reload.
  expect((await page.request.put(`/api/v1/wiki/site/pages/${slug}`, { data: { title, body: '# Soil\n\nDig deep.', base_revision: 1 }, headers: h })).ok()).toBe(true);
  await expect(page.getByRole('article').getByText('Dig deep.')).toBeVisible();

  // Typing a title that already exists opens that page.
  await page.getByPlaceholder('Title of a new page').fill(title);
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await expect(page.getByText(`${title} is already here, so it opened.`)).toBeVisible();

  // Hidden pages leave the list, and moderators see them below it with a way back.
  expect((await page.request.post(`/api/v1/wiki/site/pages/${slug}/hide`, { data: { reason: 'checking' }, headers: h })).ok()).toBe(true);
  await page.goto('/wiki/pages');
  const removed = page.getByRole('region', { name: 'Hidden and deleted pages' });
  await expect(removed.getByRole('link', { name: title })).toBeVisible();
  await scan(page, 'all pages with the hidden list');
  await removed.getByRole('button', { name: `Show page again: ${title}` }).click();
  await expect(page.locator('.wiki-index').first().getByRole('link', { name: title })).toBeVisible();
});
