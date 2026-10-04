import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';
import { Buffer } from 'node:buffer';

// Personal touches (M9-D): status line, avatar, directory, notification choices, device preferences.
const h = { origin: BASE_URL };
// An 8×8 blue PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPQSDmBFTEMLQkADrdVAXewdLIAAAAASUVORK5CYII=', 'base64');

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), what).toEqual([]);
}

test('a status line and an avatar show on the profile, and an admin can take the avatar down', async ({ page, browser }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/profile');
  await page.getByLabel('Status line').fill('Tuning a synth');
  await page.getByRole('button', { name: 'Update status' }).click();
  await page.getByLabel('Show that I am away').check();
  await page.getByLabel('Choose a picture').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: 'Remove picture' })).toBeVisible();
  await scan(page, 'profile settings with a picture');

  await page.goto(`/people/${u.handle}`);
  await expect(page.getByText('Tuning a synth')).toBeVisible();
  await expect(page.getByText('Away', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.profile-head .avatar img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link to this profile' })).toBeVisible();
  await scan(page, 'a profile');

  // An admin takes it down: the picture goes, the person stays.
  const me = (await (await page.request.get('/api/v1/me')).json()).user.id as string;
  const adminCtx = await browser.newContext({ baseURL: BASE_URL });
  const ap = await adminCtx.newPage();
  const admin = await makeAdmin(page);
  await signIn(ap, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
  const r = await ap.request.delete(`/api/v1/admin/users/${me}/avatar`, { data: { reason: 'Not suitable' }, headers: h });
  expect(r.status()).toBe(204);
  await page.reload();
  await expect(page.locator('.profile-head .avatar img')).toHaveCount(0);
  await adminCtx.close();
});

test('the directory finds people by name and filters by role', async ({ page }) => {
  const word = uniq('dir').replace(/[^a-z]/g, 'q');
  const a = await makeUser(page, { handle: `${word}ann` });
  const b = await makeUser(page, { handle: `${word}bo` });
  await setRole(b.handle, 'trusted');
  await signIn(page, a.handle, PASSWORD);
  await page.goto('/people');
  await page.getByLabel('Search by name or handle').fill(word);
  await expect(page.getByRole('link', { name: new RegExp(`${word}bo`) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`${word}ann`) }).first()).toBeVisible();
  await page.getByLabel('Show').selectOption('trusted');
  await expect(page.getByLabel('Everyone', { exact: true }).getByRole('link', { name: new RegExp(`${word}ann`) })).toHaveCount(0);
  await expect(page.getByLabel('Everyone', { exact: true }).getByRole('link', { name: new RegExp(`${word}bo`) })).toBeVisible();
  await scan(page, 'the directory');
});

test('turning off replies stops that notification, and a muted board goes quiet', async ({ page, browser }) => {
  const owner = await makeUser(page);
  await setRole(owner.handle, 'trusted');
  const other = await makeUser(page);
  const api = page.context().request;
  await api.post('/api/v1/auth/login', { data: { identifier: owner.handle, password: PASSWORD }, headers: h });
  const slug = uniq('mut');
  await api.post('/api/v1/boards', { data: { slug, name: 'Quiet', visibility: 'public' }, headers: h });
  const t = await (await api.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Hello', body: 'First' }, headers: h })).json();
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  await signIn(page, owner.handle, PASSWORD);

  await page.goto('/settings/notifications');
  await scan(page, 'notification settings');
  await page.getByLabel('Someone replies to my post').uncheck();
  await expect(page.getByLabel('Someone replies to my post')).not.toBeChecked();
  const oc = await browser.newContext({ baseURL: BASE_URL });
  const op = await oc.newPage();
  await signIn(op, other.handle, PASSWORD);
  const r = await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'a reply', reply_to: t.id }, headers: h });
  expect(r.status()).toBe(201);
  expect((await (await page.request.get('/api/v1/notifications/count')).json()).unread).toBe(0);

  await page.getByLabel('Someone replies to my post').check();
  await page.goto(`/boards/${slug}`);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeVisible();
  await op.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'another reply', reply_to: t.id }, headers: h });
  expect((await (await page.request.get('/api/v1/notifications/count')).json()).unread).toBe(0);
  await page.goto('/settings/notifications');
  await expect(page.getByRole('listitem').filter({ hasText: 'Quiet' })).toBeVisible();
  await oc.close();
});

test('device preferences for chat, boards and the terminal are saved on this device', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/boards');
  await page.getByRole('group', { name: 'Open threads as' }).getByRole('button', { name: 'Threaded' }).click();
  await page.getByLabel('Show reactions on posts').uncheck();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Open threads as' }).getByRole('button', { name: 'Threaded' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Show reactions on posts')).not.toBeChecked();
  await scan(page, 'board settings');
  await page.goto('/settings/terminal');
  await page.getByLabel('Text size').selectOption('20');
  await page.reload();
  await expect(page.getByLabel('Text size')).toHaveValue('20');
});

test('a muted mail conversation is marked in the inbox', async ({ page }) => {
  const a = await makeUser(page);
  const b = await makeUser(page);
  const api = page.context().request;
  await api.post('/api/v1/auth/login', { data: { identifier: a.handle, password: PASSWORD }, headers: h });
  const th = await (await api.post('/api/v1/mail', { data: { to: [b.handle], subject: `Chatter ${uniq('x')}`, body: 'hello' }, headers: h })).json();
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  await signIn(page, b.handle, PASSWORD);
  await page.goto(`/mail/${th.id}`);
  await page.getByText('Add someone, mute or leave').click();
  await page.getByRole('button', { name: 'Mute this conversation' }).click();
  await page.goto('/mail');
  await expect(page.getByText('Muted', { exact: true })).toBeVisible();
});
