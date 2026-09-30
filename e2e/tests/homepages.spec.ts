import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL, HOMES_DOMAIN, HOMES_PORT } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, signIn, totp, uniq } from '../support/helpers';

const home = (handle: string, path = '') => `http://${handle}.${HOMES_DOMAIN}:${HOMES_PORT}/${path}`;
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

// A person with a front page that carries all four widgets, made the way the studio's snippets say to.
async function withWidgets(page: Page, opts: { title?: string } = {}) {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  const snippets = (await (await page.request.get('/api/v1/homes/me/snippets')).json()).snippets as { html: string }[];
  const body = `<!doctype html><title>t</title><h1>Widgets</h1><div id="w">${snippets.map((s) => `<p>${s.html}</p>`).join('')}</div>`;
  expect((await page.request.put('/api/v1/homes/me/file?path=index.html', { data: Buffer.from(body), headers: { ...h, 'content-type': 'application/octet-stream' } })).ok()).toBe(true);
  if (opts.title) await page.request.patch('/api/v1/homes/me', { data: { title: opts.title, description: `About ${opts.title}` }, headers: h });
  return u;
}

test.describe('widgets and directory', () => {
  test('the four widgets work on a real homepage, from another origin', async ({ page }) => {
    const u = await withWidgets(page);
    const visitor = await page.context().newPage();
    await visitor.goto(home(u.handle));
    await expect(visitor.getByLabel('Visitors: 1')).toBeVisible();
    await expect(visitor.getByText(/^Last updated /)).toBeVisible();
    await expect(visitor.getByText(/(Online now|Offline)$/)).toBeVisible();
    const box = visitor.getByRole('region', { name: 'Guestbook' });
    await expect(box.getByText('No entries yet. Be the first to sign.')).toBeVisible();
    await box.getByLabel('Your name').fill('Zero Cool');
    await box.getByLabel('Your web address (optional)').fill('example.org/hack');
    await box.getByLabel('Your message').fill('<b>Hello</b> from the widget');
    await box.getByRole('button', { name: 'Sign the guestbook' }).click();
    await expect(box.getByText('Thanks for signing.')).toBeVisible();
    // Shown as text, exactly as typed, never as markup.
    await expect(box.getByText('<b>Hello</b> from the widget')).toBeVisible();
    await expect(box.locator('b')).toHaveCount(0);
    await expect(box.getByRole('link', { name: 'http://example.org/hack' })).toHaveAttribute('rel', /nofollow/);

    // A second visit in the same browser session does not count again.
    await visitor.reload();
    await expect(visitor.getByLabel('Visitors: 1')).toBeVisible();
    await visitor.close();
  });

  test('the owner approves entries when the guestbook asks for approval', async ({ page }) => {
    const u = await withWidgets(page);
    await page.request.patch('/api/v1/homes/me', { data: { guestbook_mode: 'approval' }, headers: h });
    const visitor = await page.context().newPage();
    await visitor.goto(home(u.handle));
    const box = visitor.getByRole('region', { name: 'Guestbook' });
    await box.getByLabel('Your name').fill('Newcomer');
    await box.getByLabel('Your message').fill('May I sign?');
    await box.getByRole('button', { name: 'Sign the guestbook' }).click();
    await expect(box.getByText('The owner will read your message before it shows up.', { exact: false })).toBeVisible();
    await expect(box.getByText('May I sign?')).toHaveCount(0);

    await page.goto('/studio/guestbook');
    await expect(page.getByText('Waiting for you')).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await visitor.reload();
    await expect(visitor.getByRole('region', { name: 'Guestbook' }).getByText('May I sign?')).toBeVisible();
    await visitor.close();
  });

  test('the directory lists pages, searches them, and people can sign a guestbook from the site', async ({ page, browser }) => {
    const title = `Garden ${uniq('g')}`;
    const owner = await withWidgets(page, { title });
    const visitorCtx = await browser.newContext({ baseURL: BASE_URL });
    const v = await visitorCtx.newPage();
    await v.goto('/homepages');
    await v.getByLabel('Search homepages').fill(title);
    await v.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(v.getByRole('link', { name: `Visit ${title}` })).toBeVisible();
    await expect(v.getByText(`About ${title}`)).toBeVisible();
    await v.getByRole('link', { name: 'Guestbook', exact: true }).first().click();
    await expect(v.getByRole('heading', { level: 2, name: `Guestbook of ${owner.handle}` })).toBeVisible();

    const other = await makeUser(page);
    await signIn(v, other.handle, PASSWORD);
    await v.goto(`/homepages/guestbook/${owner.handle}`);
    await expect(v.getByText(`Signing as ${other.handle}`)).toBeVisible();
    await v.getByLabel('Your message').fill('Signed in as myself.');
    await v.getByRole('button', { name: 'Sign the guestbook' }).click();
    await expect(v.getByText('Thanks for signing.')).toBeVisible();
    await expect(v.locator('.rows').getByText('Signed in as myself.')).toBeVisible();
    await visitorCtx.close();
  });

  test('a visitor reports a page from its footer, and an admin hides it', async ({ page, browser }) => {
    const title = `Reported ${uniq('r')}`;
    const owner = await withWidgets(page, { title });
    const reporter = await makeUser(page);
    const rc = await browser.newContext({ baseURL: BASE_URL });
    const rp = await rc.newPage();
    await signIn(rp, reporter.handle, PASSWORD);
    await rp.goto(home(owner.handle));
    await rp.getByRole('link', { name: 'Report this page' }).click();
    await expect(rp).toHaveURL(new RegExp(`/report/homepage/${owner.handle}$`));
    await rp.getByLabel('What is wrong with it').selectOption('spam');
    await rp.getByLabel('Anything the moderators should know (optional)').fill('Selling things.');
    await rp.getByRole('button', { name: 'Send report' }).click();
    await expect(rp.getByText('Thanks. The admins have your report.')).toBeVisible();
    await rc.close();

    const admin = await makeAdmin(page);
    const ac = await browser.newContext({ baseURL: BASE_URL });
    const ap = await ac.newPage();
    await signIn(ap, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
    await ap.goto('/admin/reports');
    const card = ap.getByRole('listitem').filter({ hasText: `Homepage of ${owner.handle}` });
    await expect(card.getByText('Selling things.')).toBeVisible();
    await card.getByRole('button', { name: 'Hide this page' }).click();
    await card.getByLabel('Reason').fill('Spam');
    await card.getByRole('button', { name: 'Confirm' }).click();
    await expect(ap.getByText(`Homepage of ${owner.handle}`)).toHaveCount(0);
    const gone = await (await ac.newPage()).goto(home(owner.handle));
    expect(gone!.status()).toBe(410);

    await ap.goto('/admin/homepages');
    await expect(ap.getByRole('row', { name: new RegExp(owner.handle) }).getByText('Hidden')).toBeVisible();
    await ap.getByLabel('Search by handle or title').fill(owner.handle);
    await ap.getByRole('button', { name: `Hide the homepage of ${owner.handle}` }).or(ap.getByRole('button', { name: 'Restore' })).first().click();
    await ap.getByLabel('Reason').fill('Checked, it is fine');
    await ap.getByRole('button', { name: 'Confirm' }).click();
    await expect.poll(async () => (await (await ac.newPage()).goto(home(owner.handle)))!.status()).toBe(200);
    await ac.close();
  });

  for (const theme of ['modern', 'amber'] as const) {
    test(`accessibility of the directory, guestbook and widgets screens (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      const u = await withWidgets(page, { title: `A11y ${uniq('a')}` });
      await page.request.post(`/api/v1/widgets/${u.handle}/guestbook`, { data: { name: 'Scan', message: 'For the scan.' }, headers: h });
      for (const path of ['/homepages', `/homepages/guestbook/${u.handle}`, '/studio/widgets', '/studio/guestbook', `/report/homepage/${u.handle}`]) {
        await page.goto(path);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await expect(page.getByText('Loading')).toHaveCount(0);
        await scan(page, `${path} (${theme})`);
      }
    });
  }
});
