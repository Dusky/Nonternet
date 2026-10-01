import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL, HOMES_DOMAIN, HOMES_PORT } from '../support/stack';

// Homepage toys (M9-E): counter looks, the button maker, signing a guestbook with your account, ring banners.
const h = { origin: BASE_URL };
const home = (handle: string, path = '') => `http://${handle}.${HOMES_DOMAIN}:${HOMES_PORT}/${path}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPQSDmBFTEMLQkADrdVAXewdLIAAAAASUVORK5CYII=', 'base64');

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}

test('the studio picks a counter look and makes an 88x31 button', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/studio/widgets');
  await expect(page.getByRole('group', { name: 'Visitor counter' })).toContainText('widgets/counter.js');
  await page.getByLabel('Counter look').selectOption('lcd');
  await expect(page.getByRole('group', { name: 'Visitor counter' })).toContainText('data-style="lcd"');
  await page.getByLabel('Top line').fill('NO ADS');
  await page.getByLabel('Bottom line (optional)').fill('HERE');
  const preview = page.getByRole('img', { name: 'Your button' });
  await expect(preview).toHaveAttribute('src', /button\.svg\?text=NO\+ADS%7CHERE/);
  const svg = await page.request.get((await preview.getAttribute('src'))!);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  expect(await svg.text()).toContain('>NO ADS<');
  const png = await page.request.get('/widgets/button.png?text=HELLO&fg=ffffff&bg=000000');
  expect(png.headers()['content-type']).toBe('image/png');
  expect((await page.request.get('/widgets/button.svg?text=x&fg=notacolour')).status()).toBe(400);
  await scan(page, 'studio widgets');
});

test('a signed-in visitor signs a guestbook with their account, from the homepage itself', async ({ page, browser }) => {
  const owner = await makeUser(page);
  await signIn(page, owner.handle, PASSWORD);
  const snippets = (await (await page.request.get('/api/v1/homes/me/snippets')).json()).snippets as { id: string; html: string }[];
  const gb = snippets.find((s) => s.id === 'guestbook')!.html;
  expect((await page.request.put('/api/v1/homes/me/file?path=index.html', { data: Buffer.from(`<!doctype html><title>t</title><h1>Hi</h1>${gb}`), headers: { ...h, 'content-type': 'application/octet-stream' } })).ok()).toBe(true);

  const visitor = await makeUser(page);
  const vc = await browser.newContext();
  const vp = await vc.newPage();
  await signIn(vp, visitor.handle, PASSWORD);
  await vp.goto(home(owner.handle));
  await vp.getByRole('link', { name: 'Sign with your account instead' }).click();
  await vp.waitForURL(new RegExp(`${owner.handle}\\.${HOMES_DOMAIN.replace('.', '\\.')}`));
  const box = vp.getByRole('region', { name: 'Guestbook' });
  await expect(box.getByText('You are signing with your account on this site.')).toBeVisible();
  expect(vp.url()).not.toContain('gbticket'); // the pass is taken out of the address at once
  await box.getByLabel('Your message').fill('Signed as me');
  await box.getByRole('button', { name: 'Sign the guestbook' }).click();
  await expect(box.getByText('Thanks for signing.')).toBeVisible();
  const mine = (await (await page.request.get('/api/v1/homes/me/guestbook')).json()).entries as { message: string; member: string | null }[];
  expect(mine.find((e) => e.message === 'Signed as me')?.member).toBe(visitor.handle);
  await vc.close();
});

test('a ring op uploads banners that anyone can see, and an upload that is not a picture is refused', async ({ page, browser }) => {
  const u = await makeUser(page);
  await setRole(u.handle, 'trusted');
  await signIn(page, u.handle, PASSWORD);
  const slug = uniq('banner');
  expect((await page.request.post('/api/v1/rings', { data: { slug, name: 'Banner ring', description: 'x', tags: [] }, headers: h })).ok()).toBe(true);
  await page.goto(`/rings/${slug}`);
  await page.getByLabel('Upload 468x60 banner').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'This ring’s banner' }).first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Snippet for the 468x60 banner' })).toContainText('/banner/468x60');
  await scan(page, 'ring page with a banner');
  await page.getByLabel('Upload 88x31 banner').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') });
  await expect(page.getByRole('alert')).toContainText('does not look like');
  const vc = await browser.newContext({ baseURL: BASE_URL });
  const vp = await vc.newPage();
  await vp.goto(`/rings/${slug}`);
  await expect(vp.getByRole('img', { name: 'This ring’s banner' })).toBeVisible();
  await vc.close();
});
