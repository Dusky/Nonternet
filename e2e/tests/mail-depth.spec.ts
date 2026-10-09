import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Mail depth (docs/23, E4): star, archive with Undo, mark unread, and renaming a group.
const h = { origin: BASE_URL };

test('stars, archives with undo, marks unread, and renames a group', async ({ page, browser }) => {
  const me = await makeUser(page);
  const bob = await makeUser(page);
  const carol = await makeUser(page);
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const bp = await ctx.newPage();
  await signIn(bp, bob.handle, PASSWORD);
  const solo = uniq('Solo ');
  const group = uniq('Group ');
  await bp.request.post('/api/v1/mail', { data: { to: [me.handle], subject: solo, body: 'hello' }, headers: h });
  const g = await (await bp.request.post('/api/v1/mail', { data: { to: [me.handle, carol.handle], subject: group, body: 'plans' }, headers: h })).json();

  await signIn(page, me.handle, PASSWORD);
  await page.goto('/mail');
  const row = (s: string) => page.locator('.mail-row', { hasText: s });
  await expect(row(solo)).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // Star one, and it shows under Starred.
  await row(solo).getByRole('button', { name: 'Star' }).click();
  await page.getByRole('button', { name: 'Starred', exact: true }).click();
  await expect(row(solo)).toBeVisible();
  await expect(row(group)).toHaveCount(0);
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();

  // Archive it: gone from the inbox, there under Archived; Undo brings it back.
  await row(solo).getByRole('button', { name: 'Archive' }).click();
  await expect(row(solo)).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await expect(row(solo)).toBeVisible();
  await row(solo).getByRole('button', { name: 'Move to inbox' }).click();
  await expect(row(solo)).toHaveCount(0);
  await page.getByRole('button', { name: 'Inbox', exact: true }).click();
  await expect(row(solo)).toBeVisible();

  // Mark the group unread after reading it, then rename it.
  await page.goto(`/mail/${g.id}`);
  await expect(page.getByRole('heading', { name: group })).toBeVisible();
  await page.getByText('Add someone, mute or leave').click();
  const renamed = uniq('Renamed ');
  await page.getByLabel('Rename this conversation').fill(renamed);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();
  await expect(page.getByText(`renamed this conversation to "${renamed}"`)).toBeVisible();
  await page.getByRole('button', { name: 'Mark unread' }).click();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Mail, 1 unread', exact: true })).toBeVisible();
  await ctx.close();
});
