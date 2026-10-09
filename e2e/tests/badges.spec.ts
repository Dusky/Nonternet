import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Badges on app icons (docs/10): mail, things aimed at you in Boards (a mention is stronger), and a way to clear them.
const h = { origin: BASE_URL };

test('icons show what is waiting, name it for screen readers, and can be marked read', async ({ page, browser, isMobile }) => {
  const alice = await makeUser(page);
  const bob = await makeUser(page);
  await setRole(bob.handle, 'trusted');
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const bp = await ctx.newPage();
  await signIn(bp, bob.handle, PASSWORD);
  const slug = uniq('badge');
  await bp.request.post('/api/v1/boards', { data: { slug, name: 'Badges', visibility: 'public' }, headers: h });
  await bp.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Hello there', body: `hi @${alice.handle}` }, headers: h });
  await bp.request.post('/api/v1/mail', { data: { to: [alice.handle], subject: uniq('Hi '), body: 'x' }, headers: h });
  await ctx.close();

  await signIn(page, alice.handle, PASSWORD);
  await page.goto('/');
  const grid = page.locator(isMobile ? '.launcher-apps' : 'ul.icons');
  const boards = grid.locator('[data-badge="boards"]');
  await expect(boards).toHaveText('1');
  await expect(boards).toHaveClass(/is-strong/); // a mention
  await expect(grid.locator('[data-badge="mail"]')).toHaveText('1');
  await expect(grid.getByRole(isMobile ? 'link' : 'button', { name: /Boards, 1 unread/ })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // It is server data: still there after a reload.
  await page.reload();
  await expect(grid.locator('[data-badge="boards"]')).toHaveText('1');

  if (!isMobile) {
    await grid.getByRole('button', { name: /Boards, 1 unread/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark these read' }).click();
    await expect(grid.locator('[data-badge="boards"]')).toHaveCount(0);
    await expect(grid.locator('[data-badge="mail"]')).toHaveText('1'); // only Boards' things were cleared
    await grid.getByRole('button', { name: /Mail, 1 unread/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mark these read' }).click();
    await expect(grid.locator('[data-badge="mail"]')).toHaveCount(0);
  }
});

test('the installed-app badge follows the count, and a user sees no Admin badge', async ({ page, browser }) => {
  await page.addInitScript(() => {
    (window as unknown as { __badge: number | null }).__badge = null;
    Object.assign(navigator, {
      setAppBadge: async (n: number) => { (window as unknown as { __badge: number | null }).__badge = n; },
      clearAppBadge: async () => { (window as unknown as { __badge: number | null }).__badge = 0; },
    });
  });
  const alice = await makeUser(page);
  const bob = await makeUser(page);
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const bp = await ctx.newPage();
  await signIn(bp, bob.handle, PASSWORD);
  await bp.request.post('/api/v1/mail', { data: { to: [alice.handle], subject: uniq('Ping '), body: 'x' }, headers: h });
  await ctx.close();
  await signIn(page, alice.handle, PASSWORD);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __badge: number | null }).__badge)).toBeGreaterThan(0);
  await expect(page.locator('[data-badge="admin"]')).toHaveCount(0);
});
