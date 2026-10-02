import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import pg from 'pg';
import { BASE_URL, cli, TMP } from './stack';

export const PASSWORD = 'correct horse battery';
export const uniq = (prefix: string) => `${prefix}${randomBytes(3).toString('hex')}`;

// A TOTP code for the current 30 s step (offset 1 = the next step, which the server also accepts).
export const totp = (secret: string, stepOffset = 0) => generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * stepOffset });

// Mail is written to core's log when there is no SMTP server: find the link in the mail to an address.
export async function linkFor(email: string, kind: 'verify-email' | 'reset-password'): Promise<string> {
  let link = '';
  await expect.poll(() => {
    const log = readFileSync(join(TMP, 'core.log'), 'utf8');
    const blocks = log.split('[mail to ').filter((b) => b.startsWith(`${email}]`));
    const found = blocks.flatMap((b) => [...b.matchAll(new RegExp(`(https?://[^\\s]+/${kind}\\?token=[^\\s]+)`, 'g'))].map((m) => m[1]!));
    link = found.at(-1) ?? '';
    return link;
  }, { message: `no ${kind} email for ${email}`, timeout: 8000 }).not.toBe('');
  return link;
}

// The six-digit code in the confirmation email, for signing up from the terminal.
export async function codeFor(email: string): Promise<string> {
  let code = '';
  await expect.poll(() => {
    const log = readFileSync(join(TMP, 'core.log'), 'utf8');
    const blocks = log.split('[mail to ').filter((b) => b.startsWith(`${email}]`));
    code = blocks.flatMap((b) => [...b.matchAll(/type this code there: (\d{6})/g)].map((m) => m[1]!)).at(-1) ?? '';
    return code;
  }, { message: `no code email for ${email}`, timeout: 8000 }).not.toBe('');
  return code;
}

// A fresh invite code, made by an admin straight in the database.
export async function newInvite(): Promise<string> {
  const stack = JSON.parse(readFileSync(join(TMP, 'stack.json'), 'utf8')) as { DATABASE_URL: string };
  const db = new pg.Client({ connectionString: stack.DATABASE_URL });
  await db.connect();
  const code = `E2E-${randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    if ((await db.query(`SELECT 1 FROM users WHERE role = 'admin'`)).rowCount === 0) {
      cli(['create-admin', '--handle', 'seedadmin', '--email', 'seedadmin@example.test'], { ADMIN_PASSWORD: PASSWORD });
    }
    await db.query(`INSERT INTO invites (code, created_by, expires_at) SELECT $1, id, now() + interval '1 day' FROM users WHERE role = 'admin' LIMIT 1`, [code]);
  } finally { await db.end(); }
  return code;
}

export interface TestAdmin { handle: string; password: string; secret: string; recoveryCodes: string[] }

// An admin with two-factor already on, made the way an operator would (CLI), then set up over the API.
export async function makeAdmin(page: Page, opts: { withTotp?: boolean } = {}): Promise<TestAdmin> {
  const handle = uniq('chief');
  cli(['create-admin', '--handle', handle, '--email', `${handle}@example.test`], { ADMIN_PASSWORD: PASSWORD });
  const admin: TestAdmin = { handle, password: PASSWORD, secret: '', recoveryCodes: [] };
  if (opts.withTotp === false) return admin;
  const api = page.context().request;
  const origin = { origin: BASE_URL };
  expect((await api.post('/api/v1/auth/login', { data: { identifier: handle, password: PASSWORD }, headers: origin })).ok()).toBe(true);
  const setup = await (await api.post('/api/v1/me/totp/setup', { data: {}, headers: origin })).json();
  const enabled = await api.post('/api/v1/me/totp/enable', { data: { code: await totp(setup.secret) }, headers: origin });
  expect(enabled.ok()).toBe(true);
  admin.secret = setup.secret;
  admin.recoveryCodes = (await enabled.json()).recovery_codes;
  await api.post('/api/v1/auth/logout', { data: {}, headers: origin });
  return admin;
}

// A verified user, signed up properly (invite, signup, email link) but over the API and the
// database, so a test that is about something else doesn't have to click through it.
export async function makeUser(page: Page, opts: { handle?: string; verify?: boolean } = {}) {
  const handle = opts.handle ?? uniq('person');
  const email = `${handle}@example.test`;
  const stack = JSON.parse(readFileSync(join(TMP, 'stack.json'), 'utf8')) as { DATABASE_URL: string };
  const db = new pg.Client({ connectionString: stack.DATABASE_URL });
  await db.connect();
  const code = `E2E-${randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    // Invites need an admin to have made them. On a fresh database there is none yet.
    if ((await db.query(`SELECT 1 FROM users WHERE role = 'admin'`)).rowCount === 0) {
      cli(['create-admin', '--handle', 'seedadmin', '--email', 'seedadmin@example.test'], { ADMIN_PASSWORD: PASSWORD });
    }
    await db.query(`INSERT INTO invites (code, created_by, expires_at) SELECT $1, id, now() + interval '1 day' FROM users WHERE role = 'admin' LIMIT 1`, [code]);
  } finally { await db.end(); }
  const api = page.context().request;
  const origin = { origin: BASE_URL };
  const signup = await api.post('/api/v1/auth/signup', { data: { handle, email, password: PASSWORD, invite: code, age_confirmed: true }, headers: origin });
  expect(signup.ok(), await signup.text()).toBe(true);
  if (opts.verify === false) return { handle, email, password: PASSWORD, id: (await signup.json()).id as string };
  const link = await linkFor(email, 'verify-email');
  const token = new URL(link).searchParams.get('token');
  expect((await api.post('/api/v1/auth/verify-email', { data: { token }, headers: origin })).ok()).toBe(true);
  return { handle, email, password: PASSWORD, id: (await signup.json()).id as string };
}

// Gives a user a role straight in the database, the way an admin's Promote would. The role revision
// goes up too, so anything that was already signed in sees the change.
export async function setRole(handle: string, role: 'user' | 'trusted') {
  const stack = JSON.parse(readFileSync(join(TMP, 'stack.json'), 'utf8')) as { DATABASE_URL: string };
  const db = new pg.Client({ connectionString: stack.DATABASE_URL });
  await db.connect();
  try { await db.query(`UPDATE users SET role = $2, role_rev = role_rev + 1 WHERE handle = $1`, [handle, role]); } finally { await db.end(); }
}

// Marks a custom domain as verified straight in the database. Real DNS is not available to the tests,
// and the check itself is covered by the core tests with a fake resolver.
export async function markDomainVerified(domain: string) {
  const stack = JSON.parse(readFileSync(join(TMP, 'stack.json'), 'utf8')) as { DATABASE_URL: string };
  const db = new pg.Client({ connectionString: stack.DATABASE_URL });
  await db.connect();
  try { await db.query(`UPDATE custom_domains SET status = 'verified', verified_at = now() WHERE domain = $1`, [domain]); } finally { await db.end(); }
}

export async function loginViaUi(page: Page, identifier: string, password: string, second?: { recovery?: string; totp?: string }) {
  await page.goto('/login');
  await page.getByLabel('Handle or email').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  if (second?.recovery || second?.totp) {
    if (second.recovery) {
      await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
      await page.getByLabel('Recovery code').fill(second.recovery);
    } else {
      await page.getByLabel('6-digit code').fill(second.totp!);
    }
    await page.getByRole('button', { name: 'Log in' }).click();
  }
}

// Logs out through the menu and waits for the landing page, so the next step doesn't start a
// navigation while the logout's own page load is still in flight.
export async function logoutViaUi(page: Page, handle: string) {
  await page.getByRole('button', { name: `Account menu for ${handle}` }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
}

// Logs in through the form and waits until the person is really signed in, so a test that navigates
// straight afterwards doesn't cancel the login request part-way.
export async function signIn(page: Page, handle: string, password: string, second?: { recovery?: string; totp?: string }) {
  await loginViaUi(page, handle, password, second);
  await expect(page.getByRole('button', { name: `Account menu for ${handle}` })).toBeVisible();
}

// Answers the site's confirm dialog (it replaced window.confirm) by clicking its action button.
export async function confirmDialog(page: Page, button: string) {
  await page.locator('dialog[open]').getByRole('button', { name: button, exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
