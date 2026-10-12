import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { makeAdmin, makeUser, signIn, totp } from '../support/helpers';
import { BASE_URL } from '../support/stack';

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

for (const theme of ['webring', 'terminal'] as const) test(`an admin uses the command console, then replays what it did, and reads the stats (${theme})`, async ({ page }) => {
  await page.addInitScript((th) => localStorage.setItem('ui:theme', th), theme);
  const u = await makeUser(page);
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });

  await page.goto('/admin/console');
  const input = page.getByLabel('Command', { exact: true });
  await input.fill('user sh');
  await input.press('Tab');
  await expect(input).toHaveValue('user show ');
  await input.fill(`user role ${u.handle} trusted --reason "helps everyone"`);
  await input.press('Enter');
  await expect(page.getByRole('log').getByText(`${u.handle} is now trusted.`)).toBeVisible();
  await expect(input).toBeFocused(); // ready for the next command without clicking back in
  await input.fill('help');
  await input.press('Enter');
  await expect(page.getByRole('log').getByRole('cell', { name: 'stats', exact: true })).toBeVisible();
  await input.press('ArrowUp');
  await expect(input).toHaveValue('help');
  await scan(page, 'the command console');

  await page.goto('/admin/audit');
  await page.getByRole('link', { name: `Replay the history of ${u.id}` }).first().click();
  await expect(page.getByRole('heading', { name: `History of user ${u.id}` })).toBeVisible();
  const diff = page.getByRole('table');
  await expect(diff.getByRole('rowheader', { name: 'role' })).toBeVisible();
  await expect(diff.getByText('trusted')).toBeVisible();
  await scan(page, 'the audit replay');

  await page.goto('/admin/stats');
  await expect(page.getByRole('img', { name: /people active each day/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'When people post' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download retention as CSV' })).toHaveAttribute('href', /kind=cohorts/);
  await scan(page, 'the stats');
});

test('an admin filters the audit log and downloads it, makes someone an op by picking the board by name, and archives and hands over a board', async ({ page }) => {
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  const owner = await makeUser(page);
  const heir = await makeUser(page);
  const slug = `cake${Date.now().toString(36)}`;
  const origin = { origin: BASE_URL };
  const board = await (await page.request.post('/api/v1/boards', { data: { slug, name: `Cake club ${slug}`, visibility: 'public' }, headers: origin })).json();

  // Audit: by who, by kind of action, and the same as a file.
  await page.goto('/admin/audit');
  await page.getByLabel('Done by (handle)').fill(admin.handle);
  await page.getByRole('group', { name: 'Kinds of action' }).getByRole('button', { name: 'board', exact: true }).click();
  await expect(page.locator('.timeline li').filter({ hasText: 'board.created' }).first()).toBeVisible();
  await expect(page.locator('.timeline li').filter({ hasText: 'user.role_changed' })).toHaveCount(0);
  await scan(page, 'the audit log with filters');
  const href = await page.getByRole('link', { name: 'Download these as CSV' }).getAttribute('href');
  expect(href).toContain('action=board.*');
  const csv = await (await page.request.get(href!)).text();
  expect(csv.split('\r\n')[0]).toBe('id,at,actor,actor_kind,action,target_type,target_id,target,origin,reason');
  expect(csv).toContain('board.created');

  // Ops: the board is found by its name, never typed as an id.
  await page.goto(`/admin/users/${owner.id}`);
  await page.getByLabel('Find the place by name').fill('Cake club');
  await page.getByRole('group', { name: 'Places that match' }).getByRole('button', { name: new RegExp(slug) }).click();
  await page.getByLabel('Why (kept in the audit log)').fill('runs the bake-off');
  await page.getByRole('button', { name: /Make them an op of Cake club/ }).click();
  await expect(page.getByText(`board:${board.id}`)).toBeVisible();

  // Boards: find it, archive it, give it to someone else.
  await page.goto('/admin/boards');
  await page.getByLabel('Find a board by name, address or owner').fill(slug);
  const row = page.getByRole('row').filter({ hasText: `Cake club ${slug}` });
  await row.getByRole('button', { name: /^Archive: / }).click();
  await expect(row.getByText('Archived')).toBeVisible();
  await row.getByRole('button', { name: /^Give to someone: / }).click();
  const form = page.getByRole('form', { name: /Give Cake club/ });
  await form.getByLabel('Their handle').fill(heir.handle);
  await form.getByLabel('Reason').fill('owner asked');
  await form.getByRole('button', { name: 'Give to someone' }).click();
  await expect(row).toContainText(heir.handle); // the new owner
});

test('an admin makes board categories, files a board under one, reorders and deletes them, and the board list follows', async ({ page }) => {
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  const tag = Date.now().toString(36);
  const slug = `cat${tag}`;
  await page.request.post('/api/v1/boards', { data: { slug, name: `Filed ${tag}`, visibility: 'public' }, headers: { origin: BASE_URL } });
  await page.goto('/admin/boards');
  const cats = page.getByRole('region', { name: 'Categories' });
  for (const n of [`Zebra ${tag}`, `Yak ${tag}`]) {
    await cats.getByLabel('New category').fill(n);
    await cats.getByRole('button', { name: 'Add category' }).click();
    await expect(cats.getByText(n, { exact: true })).toBeVisible();
  }
  await cats.getByRole('button', { name: `Move up: Yak ${tag}` }).click();
  await expect(cats.getByRole('listitem').filter({ hasText: `Yak ${tag}` })).toBeVisible();
  await cats.getByRole('button', { name: `Rename: Yak ${tag}` }).click();
  await cats.getByLabel('Name', { exact: true }).fill(`Yaks ${tag}`);
  await cats.getByRole('button', { name: 'Save name' }).click();
  await expect(cats.getByText(`Yaks ${tag}`, { exact: true })).toBeVisible();

  await page.getByLabel('Find a board by name, address or owner').fill(slug);
  await page.getByLabel(`Category: Filed ${tag}`).selectOption({ label: `Yaks ${tag}` });
  await page.goto('/boards');
  await expect(page.getByRole('heading', { name: `Yaks ${tag}` })).toBeVisible();
  await expect(page.getByRole('link', { name: `Filed ${tag}` })).toBeVisible();

  await page.goto('/admin/boards');
  await page.getByRole('button', { name: `Delete: Yaks ${tag}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(`Yaks ${tag}`, { exact: true })).toHaveCount(0);
  await page.goto('/boards');
  await expect(page.getByRole('link', { name: `Filed ${tag}` })).toBeVisible(); // still there, unfiled
});

test('the admin settings page is grouped, searchable, and can show only what was changed', async ({ page }) => {
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Limits and quotas' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Joining' })).toBeVisible();
  await page.getByLabel('Find a setting').fill('theme');
  await expect(page.getByRole('heading', { name: 'Look', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Limits and quotas' })).toHaveCount(0);
  await page.getByLabel('Find a setting').fill('zzzz-nothing');
  await expect(page.getByText('No setting matches.')).toBeVisible();
  await page.getByLabel('Find a setting').fill('');
  // Change one, and "only the ones I have changed" leaves just that one.
  const row = page.getByRole('region', { name: /^Minimum age/ });
  const now = await row.getByLabel('New value').inputValue(); // the desktop and phone runs share one site
  await row.getByLabel('New value').fill(now === '18' ? '19' : '18');
  await row.getByLabel('Reason').fill('testing the filter');
  await row.getByRole('button', { name: 'Review change' }).click();
  const confirm = row.getByRole('button', { name: 'Make this change' });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(row.getByText(/version 1|Version 1/i)).toBeVisible();
  await page.getByLabel('Only the ones I have changed').check();
  await expect(page.getByRole('region', { name: /^Minimum age/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Limits and quotas' })).toHaveCount(0);
});

test('on a phone the current page is in view in the admin and Settings rows of sections', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the rows only scroll sideways on a phone');
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  const inView = async (nav: string, link: string) => {
    const row = (await page.getByRole('navigation', { name: nav }).boundingBox())!;
    const cur = (await page.getByRole('navigation', { name: nav }).getByRole('link', { name: link, exact: true }).boundingBox())!;
    expect(cur.x, `${link} starts inside the row`).toBeGreaterThanOrEqual(row.x - 1);
    expect(cur.x + cur.width, `${link} ends inside the row`).toBeLessThanOrEqual(row.x + row.width + 1);
  };
  await page.goto('/admin/legal');
  await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Legal', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => { try { await inView('Admin', 'Legal'); return true; } catch { return false; } }).toBe(true);
  await page.goto('/settings/blocked');
  await expect.poll(async () => { try { await inView('Settings', 'Blocked'); return true; } catch { return false; } }).toBe(true);
});
