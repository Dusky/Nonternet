import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { BASE_URL } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, totp } from '../support/helpers';

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `accessibility problems on ${what}`).toEqual([]);
}

test('two trusted people vouch from a profile and an admin confirms', async ({ page, browser }) => {
  const cand = await makeUser(page);
  const t1 = await makeUser(page);
  const t2 = await makeUser(page);
  await setRole(t1.handle, 'trusted');
  await setRole(t2.handle, 'trusted');
  for (const [i, v] of [t1, t2].entries()) {
    const vp = await browser.newContext({ baseURL: BASE_URL }).then((x) => x.newPage());
    await signIn(vp, v.handle, PASSWORD);
    await vp.goto(`/people/${cand.handle}`);
    await vp.getByRole('button', { name: `Vouch for ${cand.handle}` }).click();
    await vp.getByLabel('Why they should be trusted (optional; only admins see it)').fill(`note ${i}`);
    if (i === 0) await scan(vp, 'the vouch form');
    await vp.getByRole('button', { name: 'Vouch', exact: true }).click();
    await expect(vp.getByText('You vouched for this person.', { exact: false })).toBeVisible();
    await vp.context().close();
  }

  const admin = await makeAdmin(page);
  await page.context().clearCookies();
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) });
  await page.goto('/admin/vouches');
  const row = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: cand.handle }) });
  await expect(row.getByText('ready', { exact: true })).toBeVisible();
  await expect(row.getByText('note 1')).toBeVisible();
  await scan(page, 'the vouches queue');
  await row.getByRole('button', { name: 'Confirm as trusted' }).click();
  await page.getByRole('button', { name: `Make ${cand.handle} trusted` }).click();
  await expect(page.getByText('Nobody is waiting.')).toBeVisible();
  await page.goto(`/people/${cand.handle}`);
  await expect(page.getByText('trusted', { exact: true })).toBeVisible();
});
