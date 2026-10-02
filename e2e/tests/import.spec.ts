import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// Bringing back an export (docs/12): upload the zip, see what would come back, bring it back.
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test('a person exports, loses their profile and homepage, and brings them back from the zip', async ({ page }) => {
  test.setTimeout(120_000);
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  const api = page.request;
  await api.patch('/api/v1/me', { data: { display_name: 'Before the move', bio: 'Keeps a tidy homepage.' }, headers: h });
  await api.put('/api/v1/homes/me/file?path=index.html', { data: Buffer.from('<h1>my page</h1>'), headers: { ...h, 'content-type': 'application/octet-stream' } });
  expect((await api.post('/api/v1/me/export', { data: { password: PASSWORD }, headers: h })).status()).toBe(202);
  // The worker builds it within a few seconds.
  let id = '';
  await expect.poll(async () => {
    const list = await (await api.get('/api/v1/me/exports')).json();
    id = list.exports.find((x: { status: string }) => x.status === 'ready')?.id ?? '';
    return id;
  }, { timeout: 30_000 }).not.toBe('');
  const zip = await (await api.get(`/api/v1/me/exports/${id}/download`)).body();

  // Things get lost.
  await api.patch('/api/v1/me', { data: { display_name: 'Oops', bio: null }, headers: h });
  await api.delete('/api/v1/homes/me/file?path=index.html', { headers: h });

  await page.goto('/settings/data');
  await page.getByLabel('Export zip').setInputFiles({ name: 'export.zip', mimeType: 'application/zip', buffer: zip });
  const form = page.getByRole('form', { name: /Export of / });
  await expect(form).toBeVisible();
  await expect(form.getByText('Made by this site for you')).toBeVisible();
  await expect(form.getByRole('checkbox', { name: /Your name, bio and theme/ })).toBeChecked();
  await expect(form.getByRole('checkbox', { name: /1 homepage file/ })).toBeChecked();
  await scan(page, 'the import preview');
  await form.getByLabel('Your password').fill(PASSWORD);
  await form.getByRole('button', { name: 'Bring it back' }).click();
  await expect(page.getByText('Brought back.')).toBeVisible();

  const me = await (await api.get('/api/v1/me')).json();
  expect(me.user).toMatchObject({ display_name: 'Before the move', bio: 'Keeps a tidy homepage.' });
  const mine = await (await api.get('/api/v1/homes/me')).json();
  expect(mine.files.map((f: { path: string }) => f.path)).toContain('index.html');

  // The same archive comes back only once.
  await page.getByLabel('Export zip').setInputFiles({ name: 'export.zip', mimeType: 'application/zip', buffer: zip });
  await form.getByLabel('Your password').fill(PASSWORD);
  await form.getByRole('button', { name: 'Bring it back' }).click();
  await expect(page.getByRole('alert')).toContainText('already been brought back');
});

test('a file that is not an export is refused with a plain reason', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/data');
  await page.getByLabel('Export zip').setInputFiles({ name: 'cat.zip', mimeType: 'application/zip', buffer: Buffer.from('not really a zip') });
  await expect(page.getByRole('alert')).toContainText('not an export archive');
});
