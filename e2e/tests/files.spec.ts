import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, totp, uniq } from '../support/helpers';

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test('an admin makes a file area, a trusted person uploads, and a visitor downloads it', async ({ page, browser }) => {
  const slug = uniq('area');
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  await page.goto('/files');
  await page.getByLabel('Address').fill(slug);
  await page.getByLabel('Name', { exact: true }).fill(`Demos ${slug}`);
  await page.getByLabel('Description').fill('Small programs to try.');
  await scan(page, 'the file areas list');
  await page.getByRole('button', { name: 'Make area' }).click();
  await expect(page.getByRole('link', { name: `Demos ${slug}` })).toBeVisible();

  const up = await makeUser(page);
  await setRole(up.handle, 'trusted');
  const tp = await browser.newContext({ baseURL: BASE_URL }).then((x) => x.newPage());
  await signIn(tp, up.handle, PASSWORD);
  await tp.goto(`/files/${slug}`);
  await tp.getByLabel('File', { exact: true }).setInputFiles({ name: 'hello world.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello from the file area') });
  await expect(tp.getByLabel('Name to download it as')).toHaveValue('hello_world.txt');
  await tp.getByLabel('Title (optional)').fill('A greeting');
  await scan(tp, 'a file area with the upload form');
  await tp.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(tp.getByRole('link', { name: 'hello_world.txt' })).toBeVisible();
  await expect(tp.getByText('A greeting')).toBeVisible();

  // A visitor who isn't signed in can download it.
  const vp = await browser.newContext({ baseURL: BASE_URL }).then((x) => x.newPage());
  await vp.goto(`/files/${slug}`);
  const [download] = await Promise.all([vp.waitForEvent('download'), vp.getByRole('link', { name: 'hello_world.txt' }).click()]);
  expect(download.suggestedFilename()).toBe('hello_world.txt');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe('Hello from the file area');
  await vp.reload();
  await expect(vp.getByText('downloaded 1×')).toBeVisible();
});
