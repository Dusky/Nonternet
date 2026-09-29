import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Browser, Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, totp, uniq } from '../support/helpers';

const h = { origin: BASE_URL };

async function signedInPage(browser: Browser, handle: string): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();
  await signIn(page, handle, PASSWORD);
  return page;
}

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

// A trusted owner with a board, a thread by another user, and that user's page.
async function setup(page: Page, browser: Browser) {
  const owner = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  const poster = await makeUser(page);
  const slug = uniq('mod');
  const op = await signedInPage(browser, poster.handle);
  await signIn(page, owner.handle, PASSWORD);
  await page.request.post('/api/v1/boards', { data: { slug, name: `Mod ${slug}`, visibility: 'public' }, headers: h });
  const t = await (await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Needs a look', body: 'Something questionable.' }, headers: h })).json();
  return { owner, poster, slug, thread: t.id as string, op };
}

test.describe('moderation', () => {
  test('an owner hides a post with a reason, and readers see it is hidden', async ({ page, browser }) => {
    const { slug, thread, op } = await setup(page, browser);
    await page.goto(`/boards/${slug}/t/${thread}`);
    await page.getByRole('button', { name: 'Hide', exact: true }).click();
    await page.getByLabel('Reason').fill('Off topic for this board');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('A moderator hid this post.')).toBeVisible();
    await expect(page.getByText('Something questionable.')).toBeVisible(); // moderators still see it

    await op.goto(`/boards/${slug}/t/${thread}`);
    await expect(op.getByText('No such thread.')).toBeVisible(); // the starter is hidden from readers

    await page.getByRole('button', { name: 'Unhide' }).click();
    await page.getByLabel('Reason').fill('Looked again, it is fine');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('A moderator hid this post.')).toHaveCount(0);

    await page.goto(`/boards/${slug}/modlog`);
    await expect(page.getByText(/ hid a post$/)).toBeVisible();
    await expect(page.getByText('Reason: Off topic for this board')).toBeVisible();
    await op.context().close();
  });

  test('a reader reports a post and the owner deals with it from the queue', async ({ page, browser }) => {
    const { slug, thread, op, owner } = await setup(page, browser);
    const reader = await makeUser(page);
    const rp = await signedInPage(browser, reader.handle);
    await rp.goto(`/boards/${slug}/t/${thread}`);
    await rp.getByRole('button', { name: 'Report', exact: true }).click();
    await rp.getByLabel('What is wrong with it').selectOption('abuse');
    await rp.getByLabel('Anything the moderators should know (optional)').fill('This is aimed at me.');
    await rp.getByRole('button', { name: 'Send report' }).click();
    await expect(rp.getByText('Thanks. The moderators of this board have your report.')).toBeVisible();
    await rp.context().close();

    await page.goto('/boards/reports');
    const card = page.getByRole('listitem').filter({ hasText: `Reported by ${reader.handle}` });
    await expect(card).toBeVisible();
    await expect(card.getByText('This is aimed at me.')).toBeVisible();
    await expect(card.getByText('Needs a look')).toBeVisible();
    await card.getByRole('button', { name: 'Remove' }).click();
    await card.getByLabel('Reason').fill('Harassment');
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText(`Reported by ${reader.handle}`)).toHaveCount(0); // it left the open queue
    await page.getByLabel('Show').selectOption('actioned');
    await expect(page.getByRole('listitem').filter({ hasText: `Reported by ${reader.handle}` }).getByText('Acted on').first()).toBeVisible();

    await op.goto(`/boards/${slug}/t/${thread}`);
    await expect(op.getByText('A moderator removed this post.')).toBeVisible();
    await op.context().close();
    void owner;
  });

  test('a locked thread takes no replies, and unlocking brings the reply box back', async ({ page, browser }) => {
    const { slug, thread, op } = await setup(page, browser);
    await page.goto(`/boards/${slug}/t/${thread}`);
    await page.getByRole('button', { name: 'Lock thread' }).click();
    await page.getByLabel('Reason').fill('Settled');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Locked', { exact: true })).toBeVisible();

    await op.goto(`/boards/${slug}/t/${thread}`);
    await expect(op.getByText('This thread is locked. Only moderators can reply.')).toBeVisible();
    await expect(op.getByRole('button', { name: 'Post', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Unlock thread' }).click();
    await page.getByLabel('Reason').fill('Reopened');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await op.reload();
    await expect(op.getByRole('button', { name: 'Post', exact: true })).toBeVisible();
    await op.context().close();
  });

  test('moves a thread to another board the owner runs', async ({ page, browser }) => {
    const { slug, thread, op } = await setup(page, browser);
    const other = uniq('dest');
    await page.request.post('/api/v1/boards', { data: { slug: other, name: `Dest ${other}`, visibility: 'public' }, headers: h });
    await page.goto(`/boards/${slug}/t/${thread}`);
    await page.getByRole('button', { name: 'Move thread' }).click();
    await page.getByLabel('Move to').selectOption(other);
    await page.getByLabel('Reason').fill('Belongs over there');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await op.goto(`/boards/${other}/t/${thread}`);
    await expect(op.getByRole('heading', { level: 2, name: 'Needs a look' })).toBeVisible();
    await op.context().close();
  });

  test('the owner picks an op, who then sees the moderation tools', async ({ page, browser }) => {
    const { slug, thread, poster, op } = await setup(page, browser);
    const helper = await makeUser(page);
    await page.goto(`/boards/${slug}/settings`);
    await page.getByLabel('Make someone an op (handle)').fill(helper.handle);
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByRole('button', { name: `Remove ${helper.handle} as op` })).toBeVisible();

    const hp = await signedInPage(browser, helper.handle);
    await hp.goto(`/boards/${slug}/t/${thread}`);
    await expect(hp.getByRole('group', { name: 'Moderation' })).toBeVisible();
    await hp.goto('/boards/reports');
    await expect(hp.getByLabel('Show')).toBeVisible();
    await hp.context().close();
    await op.goto(`/boards/${slug}/t/${thread}`);
    await expect(op.getByRole('group', { name: 'Moderation' })).toHaveCount(0); // the poster is nobody's op
    await op.context().close();
    void poster;
  });

  test('the admin console lists reports and boards', async ({ page, browser }) => {
    const { slug } = await setup(page, browser);
    const admin = await makeAdmin(page);
    await page.context().clearCookies();
    await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
    await page.goto('/admin/boards');
    await expect(page.getByRole('link', { name: `Mod ${slug}` })).toBeVisible();
    await page.goto('/admin/reports');
    await expect(page.getByLabel('Show')).toBeVisible();
  });

  for (const theme of ['modern', 'amber'] as const) {
    test(`accessibility of the moderation screens (${theme})`, async ({ page, browser }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      const { slug, thread, op } = await setup(page, browser);
      await page.request.post(`/api/v1/reports`, { data: { post_id: thread, category: 'spam', note: 'scan' }, headers: h }).catch(() => undefined);
      await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Another', body: 'For the log.' }, headers: h });
      await page.request.post('/api/v1/mod-actions', { data: { action: 'lock', post_id: thread, reason: 'for the scan' }, headers: h });
      for (const path of ['/boards/reports', `/boards/${slug}/modlog`, `/boards/${slug}/settings`, `/boards/${slug}/t/${thread}`]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText('Loading')).toHaveCount(0);
        await scan(page, `${path} (${theme})`);
      }
      await page.goto(`/boards/${slug}/t/${thread}`);
      await page.getByRole('button', { name: 'Hide', exact: true }).click();
      await expect(page.getByLabel('Reason')).toBeVisible();
      await scan(page, `a moderation form (${theme})`);
      await page.getByRole('button', { name: 'Move thread' }).click();
      await expect(page.getByLabel('Move to')).toBeVisible().catch(() => undefined);
      await scan(page, `the move form (${theme})`);
      await op.context().close();
    });
  }
});
