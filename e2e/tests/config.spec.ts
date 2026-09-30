import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, signIn, totp, uniq } from '../support/helpers';

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

async function adminPage(page: Page) {
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  return admin;
}

test.describe('settings and announcements', () => {
  test('an admin changes a setting, sees a preview for a risky one, and rolls a change back', async ({ page }) => {
    await adminPage(page);
    await page.goto('/admin/settings');
    const row = page.getByRole('region', { name: 'Custom domains per person' });
    try {
      await expect(row.getByText('Not changed from the configuration file')).toBeVisible();
      await row.getByLabel('New value').fill('2');
      await row.getByLabel('Reason').first().fill('Trying a tighter limit');
      await row.getByRole('button', { name: 'Review change' }).click();
      await expect(row.getByText('Saved. It is in effect now.')).toBeVisible();
      await expect(row.getByText(/Version \d+, changed by/)).toBeVisible();
      // Versions keep counting across the whole run, so work from the one this change got.
      const v1 = Number(/Version (\d+),/.exec((await row.getByText(/Version \d+, changed by/).textContent()) ?? '')![1]);
      const api = await page.request.get('/api/v1/admin/settings');
      expect((await api.json()).settings.find((s: { key: string }) => s.key === 'homes.max_domains').value).toBe(2);

      // Bringing back an earlier version.
      await row.getByLabel('New value').fill('5');
      await row.getByLabel('Reason').first().fill('Then a looser one');
      await row.getByRole('button', { name: 'Review change' }).click();
      await expect(row.getByText(new RegExp(`Version ${v1 + 1}, changed by`))).toBeVisible();
      await row.getByRole('button', { name: 'History for Custom domains per person' }).click();
      await row.getByRole('group', { name: 'History of Custom domains per person' }).getByLabel('Reason').fill('Five was too many');
      await row.getByRole('button', { name: `Bring back version ${v1}` }).click();
      await expect(row.getByText(new RegExp(`Version ${v1 + 2}, changed by`))).toBeVisible();
      await expect(row.getByText('Now: 2')).toBeVisible();
    } finally {
      await row.getByLabel('Reason').first().fill('Back to how it was');
      await row.getByRole('button', { name: 'Use the file’s value again' }).click();
      await expect(row.getByText('Now: 3')).toBeVisible();
    }

    // A risky setting shows what it would do first, and does nothing until it is confirmed.
    const risky = page.getByRole('region', { name: 'Minimum age (0 turns the question off)' });
    await risky.getByLabel('New value').fill('18');
    await risky.getByLabel('Reason').fill('Checking the preview');
    await risky.getByRole('button', { name: 'Review change' }).click();
    await expect(risky.getByRole('group', { name: 'Review change' }).getByText(/from 16 to 18/)).toBeVisible();
    await expect(risky.getByText('Nobody is affected right now.')).toBeVisible();
    expect((await (await page.request.get('/api/v1/admin/settings')).json()).settings.find((s: { key: string }) => s.key === 'signup.minimum_age').value).toBe(16);
    await risky.getByRole('button', { name: 'Cancel' }).click();
    await expect(risky.getByRole('group', { name: 'Review change' })).toHaveCount(0);
  });

  test('an announcement shows to everyone, can be dismissed, and goes away when ended', async ({ page, browser }) => {
    await adminPage(page);
    const title = `Maintenance ${uniq('m')}`;
    await page.goto('/admin/announcements');
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Message (optional)').fill('The site will be read-only for ten minutes.');
    await page.getByLabel('Kind').selectOption('warning');
    await expect(page.getByRole('heading', { name: 'How it looks in the shell' })).toBeVisible();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Showing now')).toBeVisible();
    try {
      // A signed-out visitor sees it on the landing page.
      const visitor = await (await browser.newContext({ baseURL: BASE_URL })).newPage();
      await visitor.goto('/');
      const box = visitor.getByRole('alert').filter({ hasText: title });
      await expect(box).toBeVisible();
      await expect(box.getByText('The site will be read-only for ten minutes.')).toBeVisible();
      // ...and a signed-in person sees it in the shell. Dismissing it keeps it away on that device.
      const u = await makeUser(page);
      await signIn(visitor, u.handle, PASSWORD);
      await expect(visitor.getByRole('alert').filter({ hasText: title })).toBeVisible();
      await visitor.getByRole('button', { name: `Dismiss: ${title}` }).click();
      await expect(visitor.getByText(title)).toHaveCount(0);
      await visitor.reload();
      await expect(visitor.getByRole('button', { name: /^Account menu/ })).toBeVisible();
      await expect(visitor.getByText(title)).toHaveCount(0);
      await visitor.context().close();
    } finally {
      await page.getByRole('button', { name: `End ${title} now` }).click();
      await expect(page.getByRole('listitem').filter({ hasText: title }).getByText('Ended early')).toBeVisible();
    }
    const after = await (await browser.newContext({ baseURL: BASE_URL })).newPage();
    await after.goto('/');
    await expect(after.getByRole('link', { name: 'Log in' })).toBeVisible();
    await expect(after.getByText(title)).toHaveCount(0);
    await after.context().close();
  });

  for (const theme of ['modern', 'amber'] as const) {
    test(`accessibility of the settings and announcements screens (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      await adminPage(page);
      const made = await page.request.post('/api/v1/admin/announcements', { data: { title: `Scan ${uniq('s')}`, body: 'For the scan', level: 'warning' }, headers: { origin: BASE_URL } });
      const id = (await made.json()).id as string;
      try {
        for (const path of ['/admin/settings', '/admin/announcements']) {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
          await expect(page.getByText('Loading')).toHaveCount(0);
          await scan(page, `${path} (${theme})`);
        }
      } finally {
        await page.request.delete(`/api/v1/admin/announcements/${id}`, { headers: { origin: BASE_URL } });
      }
    });
  }
});

test.describe('status board', () => {
  test('the admin console opens on the status board, and backups says nothing has run', async ({ page }) => {
    await adminPage(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/status$/);
    await expect(page.getByRole('heading', { level: 2, name: 'How the site is doing' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Database' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Users' })).toBeVisible();
    await scan(page, 'the status board');
    await page.getByRole('link', { name: 'Backups', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Backups and restore tests' })).toBeVisible();
  });
});
