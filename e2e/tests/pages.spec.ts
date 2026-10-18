import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { makeUser, PASSWORD, setRole, signIn } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Page numbers, recent places and links dropped on the desktop (docs/10, 2026-10-18).
const h = { origin: BASE_URL };

async function withBoard(page: Page) {
  const u = await makeUser(page);
  await setRole(u.handle, 'trusted');
  await signIn(page, u.handle, PASSWORD);
  const slug = `pg${Date.now() % 1000000}`;
  const made = await (await page.request.post('/api/v1/boards', { data: { slug, name: `Paged ${slug}`, visibility: 'public' }, headers: h })).json();
  const thread = await (await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Remember this thread', body: 'Somewhere to come back to.' }, headers: h })).json();
  return { u, slug, name: `Paged ${slug}`, page: made.page as number, thread: thread.id as string };
}

// Typing a number outside a text field opens the palette with it.
async function goToPage(page: Page, n: number) {
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.type(String(n));
  const palette = page.getByRole('dialog', { name: 'Go to an app, board, setting or person' });
  await expect(palette.getByRole('combobox')).toHaveValue(String(n));
  return palette;
}

test('a page number typed anywhere goes straight there: an app, then a board', async ({ page, isMobile }) => {
  const b = await withBoard(page);
  await page.goto('/');
  let palette = await goToPage(page, 200);
  await palette.getByRole('option', { name: /Page 200: Boards/ }).click();
  if (isMobile) await expect(page).toHaveURL(/\/boards$/);
  else await expect(page.locator('.window.is-focused')).toContainText('Boards');

  await page.goto('/');
  palette = await goToPage(page, b.page);
  await palette.getByRole('option', { name: `Page ${b.page}: ${b.name}` }).click();
  await expect(page.getByRole('heading', { name: b.name }).first()).toBeVisible();

  await page.goto('/');
  palette = await goToPage(page, 777);
  await expect(palette.getByRole('option', { name: 'There is no page 777.' })).toBeVisible();
});

test('boards and the apps menu show their page numbers', async ({ page, isMobile }) => {
  const b = await withBoard(page);
  await page.goto('/boards');
  await expect(page.locator('.board-link', { hasText: b.name }).locator('xpath=following-sibling::*[1]')).toHaveText(String(b.page));
  if (isMobile) return;
  await page.goto('/');
  await page.getByRole('button', { name: 'Apps', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Boards ?, page 200$/ })).toBeVisible();
});

test('a place you opened shows under Recent until you clear it', async ({ page, isMobile }) => {
  const b = await withBoard(page);
  await page.goto(`/boards/${b.slug}/t/${b.thread}`);
  await expect(page.getByText('Somewhere to come back to.')).toBeVisible();
  await page.goto('/');
  if (isMobile) {
    const row = page.getByRole('navigation', { name: 'Recent' });
    await expect(row.getByRole('link', { name: 'Remember this thread' })).toBeVisible();
    await row.getByRole('button', { name: 'Clear recent' }).click();
    await expect(row).toHaveCount(0);
    return;
  }
  await page.getByRole('button', { name: 'Recent' }).click();
  await page.getByRole('menuitem', { name: 'Remember this thread' }).click();
  await expect(page.locator('.window.is-focused')).toContainText('Somewhere to come back to.');
  await page.getByRole('button', { name: 'Recent' }).click();
  await page.getByRole('menuitem', { name: 'Clear recent' }).click();
  await page.getByRole('button', { name: 'Recent' }).click();
  await expect(page.getByRole('menuitem', { name: /Nothing yet/ })).toBeVisible();
});

test.describe('dropping a link on the desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'the desktop is for big screens');

  const drop = (page: Page, url: string, title: string) => page.evaluate(([u, t]) => {
    const dt = new DataTransfer();
    dt.setData('text/uri-list', u!);
    dt.setData('text/x-moz-url', `${u}\n${t}`);
    const el = document.querySelector('.desktop-layout')!;
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [url, title]);

  test('an outside link is saved as a bookmark with a shortcut, and Undo takes both back', async ({ page }) => {
    await withBoard(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open Boards' })).toBeVisible();
    await drop(page, 'https://nowhere.invalid/dropped', 'Dropped page');
    await expect(page.getByText('Saved and added to the desktop.')).toBeVisible();
    await expect(page.locator('[data-shortcut]')).toHaveAccessibleName('Open Dropped page (shortcut)');
    expect((await (await page.request.get('/api/v1/bookmarks')).json()).bookmarks).toHaveLength(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-shortcut]')).toHaveCount(0);
    await expect.poll(async () => (await (await page.request.get('/api/v1/bookmarks')).json()).bookmarks.length).toBe(0);
  });

  test('a link to this site becomes a shortcut to that place', async ({ page }) => {
    const b = await withBoard(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open Boards' })).toBeVisible();
    await drop(page, `${BASE_URL}/boards/${b.slug}/t/${b.thread}`, 'Remember this thread');
    const sc = page.locator('[data-shortcut]');
    await expect(sc).toHaveAccessibleName('Open Remember this thread (shortcut)');
    await sc.click();
    await expect(page.locator('.window.is-focused')).toContainText('Somewhere to come back to.');
    expect((await (await page.request.get('/api/v1/bookmarks')).json()).bookmarks).toHaveLength(0);
  });
});
