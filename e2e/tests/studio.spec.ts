import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL, HOMES_DOMAIN, HOMES_PORT } from '../support/stack';
import { makeUser, markDomainVerified, PASSWORD, signIn, uniq } from '../support/helpers';

const home = (handle: string, path = '') => `http://${handle}.${HOMES_DOMAIN}:${HOMES_PORT}/${path}`;
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test.describe('homepage studio', () => {
  test('a new user picks a template and the page is live at once, with a report link', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.goto('/studio');
    await expect(page.getByRole('heading', { name: 'Start with a template' })).toBeVisible();
    await page.getByRole('button', { name: 'Use About me' }).click();
    await expect(page.getByRole('link', { name: 'View my homepage' })).toBeVisible();
    await expect(page.getByText('index.html', { exact: true })).toBeVisible();

    const live = await page.context().newPage();
    await live.goto(home(u.handle));
    await expect(live.getByRole('heading', { level: 1, name: `Hi, I am ${u.handle}` })).toBeVisible();
    await expect(live.getByRole('link', { name: 'Report this page' })).toHaveAttribute('href', new RegExp(`/report/homepage/${u.handle}$`));
    await live.close();
  });

  test('edits a file in the editor, sees the preview update, and the live page changes', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.request.post('/api/v1/homes/me/template', { data: { template: 'blank' }, headers: h });
    await page.goto('/studio');
    await page.getByRole('button', { name: 'Edit index.html' }).click();
    await expect(page.getByRole('heading', { name: 'Editing index.html' })).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'Editor for index.html' });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('<!doctype html><title>t</title><h1>Edited in the studio</h1>');
    await expect(page.getByText('You have changes that are not saved.')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByText('Saved. The preview is up to date.')).toBeVisible();
    await expect(page.frameLocator('iframe[title="Preview of index.html"]').getByRole('heading', { name: 'Edited in the studio' })).toBeVisible();
    const live = await page.context().newPage();
    await live.goto(home(u.handle));
    await expect(live.getByRole('heading', { name: 'Edited in the studio' })).toBeVisible();
    await live.close();
  });

  test('uploads, renames and deletes files', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.request.post('/api/v1/homes/me/template', { data: { template: 'blank' }, headers: h });
    await page.goto('/studio');
    await page.getByLabel('Upload files').setInputFiles({ name: 'song.txt', mimeType: 'text/plain', buffer: Buffer.from('la la la') });
    await expect(page.getByText('Uploaded 1 files.')).toBeVisible();
    await expect(page.getByText('song.txt', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Rename or move song.txt' }).click();
    await page.getByLabel('New name').fill('music/song.txt');
    await page.getByRole('button', { name: 'Rename or move', exact: true }).last().click();
    await expect(page.getByText('music/', { exact: false }).first()).toBeVisible();
    const live = await page.context().newPage();
    const got = await live.goto(home(u.handle, 'music/song.txt'));
    expect(await got!.text()).toBe('la la la');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete music' }).click();
    await expect(page.getByText('song.txt')).toHaveCount(0);
    expect((await live.goto(home(u.handle, 'music/song.txt')))!.status()).toBe(404);
    await live.close();
    // A type that is not on the list is refused, in plain words.
    await page.getByRole('button', { name: 'New file' }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('bad.php');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('alert')).toContainText('cannot go on a homepage');
  });

  test('adds a library asset as a copy of your own', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.request.post('/api/v1/homes/me/template', { data: { template: 'blank' }, headers: h });
    await page.goto('/studio/assets');
    await page.getByRole('button', { name: 'Add Rainbow bar to my files' }).click();
    await expect(page.getByText(/assets\/divider-rainbow\.svg/)).toBeVisible();
    const live = await page.context().newPage();
    const r = await live.goto(home(u.handle, 'assets/divider-rainbow.svg'));
    expect(r!.headers()['content-type']).toBe('image/svg+xml');
    await live.close();
  });

  test('adds a custom domain, is told what to put in DNS, and it serves the page once verified', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    await page.request.post('/api/v1/homes/me/template', { data: { template: 'about-me' }, headers: h });
    const domain = `www.${uniq('site')}.e2e-custom.test`;
    await page.goto('/studio/domains');
    await page.getByLabel('Domain name').fill(domain);
    await page.getByRole('button', { name: 'Add a domain' }).click();
    await expect(page.getByText('Waiting for DNS')).toBeVisible();
    await expect(page.getByText(`_home-verify.${domain}`)).toBeVisible();
    await expect(page.getByText(/^home-verify=[0-9a-f]{32}$/)).toBeVisible();
    await expect(page.getByText(`${u.handle}.e2e-homes.test`)).toBeVisible(); // the CNAME target
    await page.getByRole('button', { name: `Check now for ${domain}` }).click();
    await expect(page.getByText(/No TXT record found|did not answer/)).toBeVisible(); // the record is not in DNS

    // Once DNS says yes (simulated here), the page is served on the person's own name.
    await markDomainVerified(domain);
    await page.reload();
    await expect(page.getByText('Verified and live')).toBeVisible();
    const live = await page.context().newPage();
    await live.goto(`http://${domain}:${HOMES_PORT}/`);
    await expect(live.getByRole('heading', { level: 1, name: `Hi, I am ${u.handle}` })).toBeVisible();
    await live.close();

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: `Remove ${domain}` }).click();
    await expect(page.getByText('No domains yet.')).toBeVisible();
    const gone = await (await page.context().newPage()).goto(`http://${domain}:${HOMES_PORT}/`);
    expect(gone!.status()).toBe(404);
  });

  // The rule from docs/07: JavaScript on a homepage must not be able to read the shell's cookies or
  // use the shell's API as the person looking at it. This is the real thing, in a real browser.
  test('homepage JavaScript cannot act as the signed-in visitor', async ({ page }) => {
    const u = await makeUser(page);
    await signIn(page, u.handle, PASSWORD);
    const script = `
      const out = document.getElementById('out');
      const log = (k, v) => { out.dataset[k] = v; };
      log('cookie', JSON.stringify(document.cookie));
      const api = ${JSON.stringify(BASE_URL)} + '/api/v1';
      fetch(api + '/me', { credentials: 'include' }).then((r) => r.json().then((j) => log('me', 'READ ' + JSON.stringify(j)))).catch((e) => log('me', 'blocked: ' + e.name));
      fetch(api + '/auth/logout', { method: 'POST', credentials: 'include', mode: 'no-cors', body: '{}', headers: { 'content-type': 'text/plain' } }).then(() => log('logout', 'sent')).catch((e) => log('logout', 'blocked: ' + e.name));
      setTimeout(() => log('done', 'yes'), 1500);`;
    const put = (path: string, body: string) => page.request.put(`/api/v1/homes/me/file?path=${path}`, { data: Buffer.from(body), headers: { ...h, 'content-type': 'application/octet-stream' } });
    expect((await put('index.html', '<!doctype html><title>x</title><div id="out"></div><script src="probe.js"></script>')).ok()).toBe(true);
    expect((await put('probe.js', script)).ok()).toBe(true);

    // Same browser, still signed in at the shell.
    const visitor = await page.context().newPage();
    await visitor.goto(home(u.handle));
    await expect(visitor.locator('#out[data-done=yes]')).toBeAttached({ timeout: 8000 });
    const data = await visitor.locator('#out').evaluate((el) => ({ ...(el as HTMLElement).dataset }));
    expect(data.cookie).toBe('""'); // none of the shell's cookies exist on this origin
    expect(data.me).toMatch(/^blocked/); // the response cannot be read from here
    await visitor.close();

    // And the forged logout did nothing: the person is still signed in.
    expect((await page.request.get('/api/v1/me')).ok()).toBe(true);
  });

  for (const theme of ['modern', 'amber'] as const) {
    test(`accessibility of the studio (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);
      const u = await makeUser(page);
      await signIn(page, u.handle, PASSWORD);
      await page.goto('/studio');
      await expect(page.getByRole('heading', { name: 'Start with a template' })).toBeVisible();
      await scan(page, `the template chooser (${theme})`);
      await page.request.post('/api/v1/homes/me/template', { data: { template: 'about-me' }, headers: h });
      for (const path of ['/studio/files', '/studio/assets', '/studio/domains', '/studio/settings']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText('Loading')).toHaveCount(0);
        await scan(page, `${path} (${theme})`);
      }
      await page.goto('/studio/files');
      await page.getByRole('button', { name: 'Edit style.css' }).click();
      await expect(page.getByRole('textbox', { name: 'Editor for style.css' })).toBeVisible();
      await scan(page, `the editor (${theme})`);
    });
  }
});
