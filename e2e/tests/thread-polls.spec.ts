import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Polls inside a thread (docs/23, E3b): started with the thread, voted on by others, closed by the author.
const h = { origin: BASE_URL };

test('a thread can carry a poll that others vote on and the author closes', async ({ page, browser }) => {
  const owner = await makeUser(page);
  const voter = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  await signIn(page, owner.handle, PASSWORD);
  const slug = uniq('poll');
  await page.request.post('/api/v1/boards', { data: { slug, name: 'Polling', visibility: 'public' }, headers: h });

  // Start a thread with a poll from the composer.
  await page.goto(`/boards/${slug}/new`);
  await page.getByLabel('Subject', { exact: false }).first().fill('Where shall we meet');
  await page.locator('#compose-body').fill('Pick one, please.');
  await page.getByText('Add a poll').click();
  await page.getByLabel('Question').fill('Which place?');
  await page.getByLabel('Choice 1').fill('The park');
  await page.getByLabel('Choice 2').fill('The cafe');
  await page.getByRole('button', { name: 'Post', exact: false }).first().click();
  await expect(page.getByRole('heading', { name: 'Which place?' })).toBeVisible();

  // Someone else votes: the tally appears only after they have.
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const vp = await ctx.newPage();
  await signIn(vp, voter.handle, PASSWORD);
  await vp.goto(`/boards/${slug}`);
  await expect(vp.getByText('Poll', { exact: true })).toBeVisible();
  await vp.getByRole('link', { name: 'Where shall we meet' }).click();
  await expect(vp.getByRole('heading', { name: 'Which place?' })).toBeVisible();
  await expect(vp.getByRole('list', { name: 'Results' })).toHaveCount(0);
  await vp.getByLabel('The cafe').check();
  await vp.getByRole('button', { name: 'Cast my vote' }).click();
  await expect(vp.getByRole('list', { name: 'Results' })).toBeVisible();
  const r = await new AxeBuilder({ page: vp }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

  // The author closes it.
  await page.reload();
  await page.getByRole('button', { name: 'Close this poll now' }).click();
  await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  await ctx.close();
});
