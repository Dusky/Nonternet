import { generateKeyPairSync } from 'node:crypto';
import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Act now, Undo for a moment (docs/10): reversible actions don't ask first. The screen changes at once and a note
// offers Undo; the server is only told when the note's time is up.
const h = { origin: BASE_URL };
// A fresh SSH key each time: a key can be on only one account, so a shared one would tie the tests together.
function newKey(): string {
  const raw = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const field = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
  return `ssh-ed25519 ${Buffer.concat([field(Buffer.from('ssh-ed25519')), field(raw)]).toString('base64')} me@laptop`;
}
const keys = async (page: import('@playwright/test').Page) => (await (await page.request.get('/api/v1/me/ssh-keys')).json()).keys.length as number;

test('removing an SSH key goes at once, Undo brings it back, and without Undo it is saved', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/terminal');
  await page.getByLabel('Public key').fill(newKey());
  await page.getByRole('button', { name: 'Add key' }).click();
  await expect(page.getByText('me@laptop', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remove the key me@laptop' }).click();
  await expect(page.getByText('No keys yet.')).toBeVisible();   // gone on screen at once, with no dialog
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('me@laptop', { exact: true })).toBeVisible();
  await page.waitForTimeout(7000);                                // past the Undo window: nothing was sent
  expect(await keys(page)).toBe(1);

  await page.getByRole('button', { name: 'Remove the key me@laptop' }).click();
  await expect(page.getByText('No keys yet.')).toBeVisible();
  await expect.poll(() => keys(page), { timeout: 15_000 }).toBe(0); // no Undo: saved
});

test('blocking a person goes at once without a dialog, and Undo unblocks', async ({ page }) => {
  const a = await makeUser(page);
  const b = await makeUser(page);
  await signIn(page, a.handle, PASSWORD);
  await page.goto(`/people/${b.handle}`);
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText(`You blocked ${b.handle}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unblock' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Block', exact: true })).toBeVisible();
  const blocks = await (await page.request.get('/api/v1/me/blocks')).json();
  expect(blocks.blocks).toHaveLength(0);
});

test('deleting your own mail message goes at once, and Undo keeps it', async ({ page }) => {
  const a = await makeUser(page);
  const b = await makeUser(page);
  await signIn(page, a.handle, PASSWORD);
  const sent = await page.request.post('/api/v1/mail', { data: { to: [b.handle], subject: 'Undo me', body: 'Keep this line' }, headers: h });
  const id = (await sent.json()).id as string;
  await page.goto(`/mail/${id}`);
  await expect(page.getByText('Keep this line')).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('Keep this line')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Keep this line')).toBeVisible();
  await page.waitForTimeout(7000);
  await page.reload();
  await expect(page.getByText('Keep this line')).toBeVisible();   // never sent to the server

  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByText('Keep this line')).toHaveCount(0);
  await page.waitForTimeout(7500);
  await page.reload();
  await expect(page.getByText('Keep this line')).toHaveCount(0);  // saved
});

test('what is still waiting is sent when you leave the page', async ({ page }) => {
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/terminal');
  await page.getByLabel('Public key').fill(newKey());
  await page.getByRole('button', { name: 'Add key' }).click();
  await expect(page.getByText('me@laptop', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove the key me@laptop' }).click();
  await expect(page.getByText('No keys yet.')).toBeVisible();
  await page.goto('/');                                           // leaving at once, inside the Undo window
  await expect.poll(() => keys(page), { timeout: 10_000 }).toBe(0);
});
