import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, setRole, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Notifications beyond board posts (docs/23, E2): mail, reactions and ring news arrive in the list and on the bell,
// a repeat is one line with a count, and opening the thing answers it.
const h = { origin: BASE_URL };

async function scan(page: Page, what: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test('mail and reactions show up as notifications, grouped, and opening them clears them', async ({ page, browser }) => {
  const alice = await makeUser(page);
  const bob = await makeUser(page);
  await setRole(alice.handle, 'trusted');
  await signIn(page, alice.handle, PASSWORD);
  const slug = uniq('notif');
  await page.request.post('/api/v1/boards', { data: { slug, name: 'Notified', visibility: 'public' }, headers: h });
  const thread = await (await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'React to this', body: 'please' }, headers: h })).json();

  // Bob writes twice to Alice in one conversation and reacts to her post.
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const bp = await ctx.newPage();
  await signIn(bp, bob.handle, PASSWORD);
  const subject = uniq('Hello ');
  const mail = await (await bp.request.post('/api/v1/mail', { data: { to: [alice.handle], subject, body: 'first' }, headers: h })).json();
  await bp.request.post(`/api/v1/mail/${mail.id}/messages`, { data: { body: 'second' }, headers: h });
  expect((await bp.request.put(`/api/v1/posts/${thread.id}/reactions/agree`, { headers: h })).ok()).toBe(true);

  await page.goto('/notifications');
  await expect(page.getByText(`wrote to you`, { exact: false }).first()).toBeVisible();
  const mailLine = page.getByRole('link', { name: /wrote to you \(2 new\)|and others wrote to you/ });
  await expect(mailLine).toBeVisible();
  await expect(page.getByRole('link', { name: `${bob.handle} reacted to your post` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 2 unread', exact: true })).toBeVisible();
  await scan(page, 'the notifications list');

  // Opening the conversation answers it.
  await mailLine.click();
  await expect(page.getByRole('heading', { name: subject }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible();
  await ctx.close();
});

test('a ring request reaches the founder, and the choices for the new kinds are in Settings', async ({ page, browser }) => {
  const founder = await makeUser(page);
  const joiner = await makeUser(page);
  await setRole(founder.handle, 'trusted');
  await signIn(page, founder.handle, PASSWORD);
  const ring = uniq('knots');
  expect((await page.request.post('/api/v1/rings', { data: { slug: ring, name: `Ring ${ring}`, join_policy: 'approval' }, headers: h })).ok()).toBe(true);
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const jp = await ctx.newPage();
  await signIn(jp, joiner.handle, PASSWORD);
  expect((await jp.request.post(`/api/v1/rings/${ring}/join`, { headers: h })).ok()).toBe(true);
  await ctx.close();

  await page.goto('/notifications');
  await expect(page.getByRole('link', { name: `${joiner.handle} asked to join a ring` })).toBeVisible();

  await page.goto('/settings/notifications');
  for (const label of ['I get new mail', 'Someone reacts to my post', 'There is news in a ring']) {
    await expect(page.getByLabel(label, { exact: false })).toBeVisible();
  }
});
