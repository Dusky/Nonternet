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

test('filter tabs, a day heading, replies to one thread folded into one line, and mark unread', async ({ page, browser }) => {
  const me = await makeUser(page);
  await setRole(me.handle, 'trusted');
  await signIn(page, me.handle, PASSWORD);
  const slug = uniq('nf').toLowerCase();
  await page.request.post('/api/v1/boards', { data: { slug, name: `Notes ${slug}`, visibility: 'public' }, headers: h });
  const t = await (await page.request.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'Ask me', body: 'anything' }, headers: h })).json();
  const threadId = t.post?.id ?? t.id;
  for (const name of ['nfa', 'nfb']) {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const p = await ctx.newPage();
    const u = await makeUser(p, { handle: uniq(name) });
    await signIn(p, u.handle, PASSWORD);
    await p.request.post(`/api/v1/boards/${slug}/posts`, { data: { body: `from ${u.handle}`, reply_to: threadId }, headers: h });
    if (name === 'nfb') await p.request.post('/api/v1/mail', { data: { to: [me.handle], subject: 'Hello there', body: 'hi' }, headers: h });
    await ctx.close();
  }
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText(/and 1 other replied to you/)).toBeVisible();
  await page.getByRole('button', { name: 'Mail', exact: true }).click();
  await expect(page.getByText(/replied to you/)).toHaveCount(0);
  await expect(page.getByText('Hello there')).toBeVisible();
  const markRead = page.getByRole('button', { name: /^Mark read:/ });
  await markRead.click();
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByText('Hello there')).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('button', { name: /^Mark unread:/ }).first().click();
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByText('Hello there')).toBeVisible();
  // Mark all read on a tab marks that tab only: the replies on the Boards tab stay unread.
  await page.getByRole('button', { name: 'Mail', exact: true }).click();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByRole('button', { name: 'Mark all read' })).toBeDisabled(); // nothing unread on this tab
  await page.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(page.getByText('Hello there')).toHaveCount(0);
  await expect(page.getByText(/and 1 other replied to you/)).toBeVisible();
  await scan(page, 'notifications with filters');
});
