import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Screenshots of every main screen, for reviewing design changes by eye. Not a test of anything:
// skipped unless SCREENSHOTS names a folder, e.g. SCREENSHOTS=/tmp/shots pnpm --filter @app/e2e test screens
const OUT = process.env.SCREENSHOTS;
const h = { origin: BASE_URL };
const VARIANTS = [
  { name: 'light', theme: 'modern', scheme: 'light' },
  { name: 'dark', theme: 'modern', scheme: 'dark' },
  { name: 'amber', theme: 'amber', scheme: 'dark' },
] as const;

test.skip(!OUT, 'set SCREENSHOTS=<folder> to take screenshots');
test.use({ actionTimeout: 15_000, navigationTimeout: 20_000 });

async function shot(page: Page, project: string, variant: string, name: string) {
  const dir = join(OUT!, project);
  mkdirSync(dir, { recursive: true });
  // Polling keeps the network busy, so wait for loading text to go instead of for an idle network.
  await page.getByText(/^Loading/).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, `${name}--${variant}.png`), fullPage: false });
}

test('every main screen, in every theme', async ({ page, browser, isMobile }, info) => {
  test.setTimeout(600_000);
  // Some content to look at: a board with a thread, a ring, a conversation.
  const owner = await makeUser(page, { handle: uniq('ada') });
  await setRole(owner.handle, 'trusted');
  const reader = await makeUser(page, { handle: uniq('lin') });
  const api = page.context().request;
  await api.post('/api/v1/auth/login', { data: { identifier: owner.handle, password: PASSWORD }, headers: h });
  await api.patch('/api/v1/me', { data: { display_name: 'Ada', bio: 'Keeps the synth board tidy. Ask me about modular patches.' }, headers: h });
  const slug = uniq('synths');
  await api.post('/api/v1/boards', { data: { slug, name: 'Synths and modular', visibility: 'public', description: 'Patches, gear, and help with both.' }, headers: h });
  const t = await (await api.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'What was your first synth?', body: 'Mine was a battered Juno-106 from a pawn shop.\nThe voice chips died a year later, but I learned everything on it.' }, headers: h })).json();
  await api.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'A Volca Keys. Small, cheap, and it taught me what a filter does.', reply_to: t.id }, headers: h });
  await api.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Patch notes thread', body: 'Post your favourite patches here, with a photo of the cables if you can.' }, headers: h });
  await api.post('/api/v1/rings', { data: { slug: uniq('lofi'), name: 'Lo-fi homepages', description: 'Hand-made pages with no trackers.', tags: ['handmade', 'music'] }, headers: h });
  await api.post('/api/v1/mail', { data: { to: [reader.handle], subject: 'Welcome aboard', body: 'Glad you made it. The synth board is the busy one.' }, headers: h });
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  for (const v of VARIANTS) {
    const ctx = await browser.newContext({ ...info.project.use, colorScheme: v.scheme });
    await ctx.addInitScript((theme) => localStorage.setItem('ui:theme', theme), v.theme);
    const p = await ctx.newPage();
    const project = info.project.name;

    for (const [name, path] of [['landing', '/'], ['login', '/login'], ['signup', '/signup'], ['public-boards', '/boards']] as const) {
      await p.goto(path);
      await expect(p.getByRole('heading').first()).toBeVisible();
      await shot(p, project, v.name, name);
    }

    await signIn(p, reader.handle, PASSWORD);
    await shot(p, project, v.name, 'home');
    const pages: [string, string][] = [
      ['boards', '/boards'], ['board', `/boards/${slug}`], ['thread', `/boards/${slug}/t/${t.id}`],
      ['rings', '/rings'], ['people', `/people/${owner.handle}`], ['mail', '/mail'], ['files', '/files'],
      ['homepages', '/homepages'], ['studio', '/studio'], ['notifications', '/notifications'],
      ['settings', '/settings/profile'], ['settings-appearance', '/settings/appearance'],
      ['chat', '/chat'], ['terminal', '/terminal'], ['mud', '/mud'], ['people-find', '/people'],
    ];
    for (const [name, path] of pages) {
      try {
        await p.goto(path, { timeout: 15_000 });
        await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
        await shot(p, project, v.name, name);
      } catch (e) { console.log(`skipped ${name} (${v.name}): ${String(e).slice(0, 200)}`); }
    }
    if (!isMobile) {
      try {
        await p.goto('/');
        await p.getByRole('button', { name: 'Open Boards' }).click();
        await p.getByRole('button', { name: 'Open Mail' }).click();
        await shot(p, project, v.name, 'desktop-windows');
      } catch (e) { console.log(`skipped desktop-windows (${v.name}): ${String(e).slice(0, 300)}`); }
    }
    await p.getByRole('button', { name: `Account menu for ${reader.handle}` }).click();
    await p.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(p.getByRole('link', { name: 'Log in' }).first()).toBeVisible();

    const admin = await makeAdmin(page); // one each time: a TOTP code can't be used twice
    await signIn(p, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
    for (const [name, path] of [['admin-status', '/admin'], ['admin-users', '/admin/users'], ['admin-audit', '/admin/audit']] as const) {
      await p.goto(path);
      await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
      await shot(p, project, v.name, name);
    }
    await ctx.close();
  }
});
