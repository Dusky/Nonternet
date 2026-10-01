import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// BBS classics on the web (M9-E): the oneliners wall, bulletins and the voting booth.
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}

test('a line goes on the wall from Home and shows to someone else; one an hour', async ({ page, browser }) => {
  const a = await makeUser(page);
  const b = await makeUser(page);
  await signIn(page, a.handle, PASSWORD);
  const line = uniq('line');
  await page.getByLabel('Put a line on the wall (one an hour)').fill(line);
  await page.getByRole('button', { name: 'Put up' }).click();
  await expect(page.getByText(line)).toBeVisible();
  await scan(page, 'home with the wall');
  await page.getByLabel('Put a line on the wall (one an hour)').fill('second');
  await page.getByRole('button', { name: 'Put up' }).click();
  await expect(page.getByRole('alert')).toContainText('one line an hour');
  const other = await browser.newContext({ baseURL: BASE_URL });
  const op = await other.newPage();
  await signIn(op, b.handle, PASSWORD);
  await expect(op.getByText(line)).toBeVisible();
  await other.close();
});

test('an admin writes a bulletin, a person reads it and it stops being new', async ({ page, browser }) => {
  const admin = await makeAdmin(page);
  const user = await makeUser(page);
  const ac = await browser.newContext({ baseURL: BASE_URL });
  const ap = await ac.newPage();
  await signIn(ap, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
  const title = `Notice ${uniq('n')}`;
  await ap.goto('/boards/bulletins');
  await ap.getByRole('button', { name: 'Write a bulletin' }).click();
  await ap.getByLabel('Title').fill(title);
  await ap.getByLabel('Notice').fill('The server moves on Sunday.');
  await ap.getByRole('button', { name: 'Put it up' }).click();
  await expect(ap.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await ac.close();

  await signIn(page, user.handle, PASSWORD);
  await page.goto('/boards/bulletins');
  await expect(page.getByText('New', { exact: true }).first()).toBeVisible();
  await scan(page, 'bulletins');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByText('The server moves on Sunday.')).toBeVisible();
  await page.goto('/boards/bulletins');
  await expect(page.getByText('New', { exact: true })).toHaveCount(0);
});

test('a trusted person asks a question, someone votes and sees the tally', async ({ page, browser }) => {
  const asker = await makeUser(page);
  await setRole(asker.handle, 'trusted');
  const voter = await makeUser(page);
  await signIn(page, asker.handle, PASSWORD);
  const q = `Best ${uniq('colour')}?`;
  await page.goto('/boards/polls');
  await page.getByRole('button', { name: 'Ask a question' }).click();
  await page.getByRole('textbox', { name: 'Question' }).fill(q);
  await page.getByLabel('Choice 1').fill('Red');
  await page.getByLabel('Choice 2').fill('Blue');
  await page.getByRole('button', { name: 'Open the poll' }).click();
  await expect(page.getByRole('heading', { name: q })).toBeVisible();

  const vc = await browser.newContext({ baseURL: BASE_URL });
  const vp = await vc.newPage();
  await signIn(vp, voter.handle, PASSWORD);
  await vp.goto('/boards/polls');
  await vp.getByRole('link', { name: q }).click();
  await expect(vp.getByText('The tally appears once you have voted.')).toBeVisible();
  await scan(vp, 'a poll before voting');
  await vp.getByLabel('Blue').check();
  await vp.getByRole('button', { name: 'Cast my vote' }).click();
  await expect(vp.getByText('1 vote in all')).toBeVisible();
  await expect(vp.getByText('your vote')).toBeVisible();
  await scan(vp, 'poll results');
  await vc.close();
});
