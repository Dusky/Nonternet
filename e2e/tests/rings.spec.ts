import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL, HOMES_DOMAIN, HOMES_PORT } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, totp, uniq } from '../support/helpers';

const home = (handle: string, path = '') => `http://${handle}.${HOMES_DOMAIN}:${HOMES_PORT}/${path}`;
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

// A homepage that carries the ring's nav bar, from the snippet the ring page gives its members.
async function pageWithBar(page: Page, slug: string, title: string) {
  const snippet = (await (await page.request.get(`/api/v1/rings/${slug}/snippet`)).json()).html as string;
  const body = `<!doctype html><title>${title}</title><h1>${title}</h1><div>${snippet}</div>`;
  expect((await page.request.put('/api/v1/homes/me/file?path=index.html', { data: Buffer.from(body), headers: { ...h, 'content-type': 'application/octet-stream' } })).ok()).toBe(true);
}

test.describe('rings', () => {
  test('a trusted user founds a ring; members join, get a working nav bar, and a removed member drops out of it', async ({ page, browser }) => {
    const founder = await makeUser(page);
    await setRole(founder.handle, 'trusted');
    await signIn(page, founder.handle, PASSWORD);
    const slug = uniq('ring');
    const name = `Ring ${slug}`;

    await page.goto('/rings/new');
    await page.getByLabel('Address').fill(slug);
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Short description').fill('A ring for tests.');
    await page.getByLabel('Tags').fill('tests, e2e');
    await page.getByRole('button', { name: 'Found the ring' }).click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    await expect(page.getByText('tests, e2e')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the ring board' })).toBeVisible();
    await pageWithBar(page, slug, `Founder page ${slug}`);

    // Two more people join an open ring, each with a page.
    const people: { handle: string; page: Page }[] = [];
    for (const label of ['One', 'Two']) {
      const u = await makeUser(page);
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const p = await ctx.newPage();
      await signIn(p, u.handle, PASSWORD);
      await p.goto(`/rings/${slug}`);
      await p.getByRole('button', { name: 'Join this ring' }).click();
      await expect(p.getByRole('heading', { name: 'Your nav bar' })).toBeVisible();
      await pageWithBar(p, slug, `Member ${label} ${slug}`);
      people.push({ handle: u.handle, page: p });
    }
    const [one, two] = people as [typeof people[0], typeof people[0]];

    // Members can post on the ring board.
    await one.page.goto(`/boards/ring-${slug}/new`);
    await one.page.getByLabel('Subject').fill('First on the ring board');
    await one.page.getByLabel('Message').fill('Hello ring.');
    await one.page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(one.page.getByRole('heading', { level: 2, name: 'First on the ring board' })).toBeVisible();

    // The bar works on a real homepage, from another origin, and next goes to the next member's page.
    const visitor = await page.context().newPage();
    await visitor.goto(home(one.handle));
    const bar = visitor.getByRole('navigation', { name: `Web ring: ${name}` });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Previous' })).toBeVisible();
    await bar.getByRole('link', { name: 'Next' }).click();
    await expect(visitor.getByRole('heading', { level: 1, name: new RegExp(`^Member Two ${slug}|^Founder page ${slug}`) })).toBeVisible();

    // The founder removes the second member: their bar says so, and the others skip them.
    await page.goto(`/rings/${slug}`);
    await page.getByRole('button', { name: `Remove ${two.handle}` }).first().click();
    await page.getByLabel('Reason', { exact: true }).fill('Left the scene');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('button', { name: `Remove ${two.handle}` })).toHaveCount(0);
    await visitor.goto(home(two.handle));
    await expect(visitor.getByText(`This page is not part of ${name} at the moment.`)).toBeVisible();
    for (let i = 0; i < 3; i++) {
      await visitor.goto(home(one.handle));
      await visitor.getByRole('navigation', { name: `Web ring: ${name}` }).getByRole('link', { name: 'Next' }).click();
      await expect(visitor.getByRole('heading', { level: 1 })).not.toHaveText(new RegExp(`Member Two`));
    }
    // Removed, they can no longer post on the ring board.
    const post = await two.page.request.post(`/api/v1/boards/ring-${slug}/posts`, { data: { subject: 'x', body: 'y' }, headers: h });
    expect(post.status()).toBe(403);
    for (const p of people) await p.page.context().close();
  });

  test('a user who is not trusted cannot found a ring, and a trusted one stops at the quota', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/rings');
    await expect(page.getByRole('link', { name: 'Found a ring' })).toHaveCount(0);
    const refused = await page.request.post('/api/v1/rings', { data: { slug: uniq('no'), name: 'Nope' }, headers: h });
    expect(refused.status()).toBe(403);

    await setRole(u.handle, 'trusted');
    await page.reload();
    await expect(page.getByRole('link', { name: 'Found a ring' })).toBeVisible();
    for (let i = 0; i < 2; i++) expect((await page.request.post('/api/v1/rings', { data: { slug: uniq('q'), name: `Quota ${i}` }, headers: h })).status()).toBe(201);
    const over = await page.request.post('/api/v1/rings', { data: { slug: uniq('q'), name: 'Quota 3' }, headers: h });
    expect(over.status()).toBe(409);
    expect((await over.json()).error.code).toBe('quota_reached');
  });

  test('the directory finds a ring by name and tag, and ring boards are grouped under their ring', async ({ page, browser }) => {
    const founder = await makeUser(page);
    await setRole(founder.handle, 'trusted');
    await signIn(page, founder.handle, PASSWORD);
    const word = uniq('zq');
    const created = await page.request.post('/api/v1/rings', { data: { slug: uniq('d'), name: `Finder ${word}`, tags: [`t${word}`], description: 'Find me' }, headers: h });
    expect(created.status()).toBe(201);
    const visitor = await (await browser.newContext({ baseURL: BASE_URL })).newPage();
    await visitor.goto('/rings');
    await visitor.getByLabel('Search rings').fill(word);
    await visitor.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(visitor.getByRole('link', { name: `Finder ${word}` })).toBeVisible();
    await visitor.goto('/boards');
    await expect(visitor.getByRole('heading', { level: 2, name: `Ring: Finder ${word}` })).toBeVisible();
    await visitor.context().close();
  });

  for (const theme of ['modern', 'amber'] as const) {
    test(`accessibility of the rings screens (${theme})`, async ({ page, browser }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      const founder = await makeUser(page);
      await setRole(founder.handle, 'trusted');
      await signIn(page, founder.handle, PASSWORD);
      const slug = uniq('a');
      await page.request.post('/api/v1/rings', { data: { slug, name: `Scan ${slug}`, description: 'For the scan', tags: ['scan'], join_policy: 'approval' }, headers: h });
      const other = await makeUser(page);
      const oc = await browser.newContext({ baseURL: BASE_URL });
      const op = await oc.newPage();
      await signIn(op, other.handle, PASSWORD);
      await op.request.post(`/api/v1/rings/${slug}/join`, { headers: h });
      await oc.close();
      for (const path of ['/rings', '/rings/new', `/rings/${slug}`]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText('Loading')).toHaveCount(0);
        await scan(page, `${path} (${theme})`);
      }
      await page.goto(`/rings/${slug}`);
      const admin = await makeAdmin(page);
      const ac = await browser.newContext({ baseURL: BASE_URL });
      const ap = await ac.newPage();
      await ap.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      await signIn(ap, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
      await ap.goto('/admin/rings');
      await expect(ap.getByRole('link', { name: `Scan ${slug}` })).toBeVisible();
      await scan(ap, `the admin rings tab (${theme})`);
      await ac.close();
    });
  }
});
