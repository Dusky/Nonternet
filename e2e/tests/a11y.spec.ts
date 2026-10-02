import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { loginViaUi, makeAdmin, makeUser, PASSWORD, signIn, uniq } from '../support/helpers';
import { BASE_URL } from '../support/stack';

// Automated accessibility checks (WCAG 2.1 A and AA) on every main screen, in both themes. This
// catches what a machine can: contrast, missing labels, bad ARIA. It does not replace using the
// site with a screen reader and a keyboard.
const THEMES = ['modern', 'amber'] as const;

async function scan(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `accessibility problems on ${what}`).toEqual([]);
}
const useTheme = (page: Page, theme: string) => page.addInitScript((t) => localStorage.setItem('ui:theme', t), theme);

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test('signed-out pages', async ({ page }) => {
      await useTheme(page, theme);
      for (const path of ['/', '/login', '/signup', '/legal/terms', '/legal/takedown', '/forgot-password', '/reset-password?token=x', '/verify-email?token=x']) {
        await page.goto(path);
        await expect(page.getByRole('heading').first()).toBeVisible();
        await scan(page, `${path} (${theme})`);
      }
    });

    test('the login page while it is asking for a code, and showing an error', async ({ page }) => {
      await useTheme(page, theme);
      const admin = await makeAdmin(page);
      await page.goto('/login');
      await page.getByLabel('Handle or email').fill(admin.handle);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Log in' }).click();
      await page.getByLabel('6-digit code').fill('000000');
      await page.getByRole('button', { name: 'Log in' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await scan(page, `second step with an error (${theme})`);
    });

    test('the screens added in M9: inbox (searching, unread only, muted), people, a profile, bulletins, polls', async ({ page }) => {
      await useTheme(page, theme);
      const a = await makeUser(page);
      const b = await makeUser(page);
      const h = { origin: BASE_URL };
      const api = page.context().request;
      await api.post('/api/v1/auth/login', { data: { identifier: a.handle, password: PASSWORD }, headers: h });
      const th = await (await api.post('/api/v1/mail', { data: { to: [b.handle], subject: `Inbox ${uniq('x')}`, body: 'hello there' }, headers: h })).json();
      await api.post('/api/v1/auth/logout', { data: {}, headers: h });
      await signIn(page, b.handle, PASSWORD);
      await page.goto('/mail');
      await expect(page.getByRole('link', { name: /Inbox/ })).toBeVisible();
      await scan(page, `the inbox (${theme})`);
      await page.getByLabel('Search your mail').fill('hello');
      await expect(page.getByRole('link', { name: /Inbox/ })).toBeVisible();
      await scan(page, `the inbox, searching (${theme})`);
      await page.getByLabel('Search your mail').fill('');
      await page.getByRole('button', { name: 'Unread only' }).click();
      await expect(page.getByRole('link', { name: /Inbox/ })).toBeVisible();
      await scan(page, `the inbox, unread only (${theme})`);
      await api.post('/api/v1/auth/login', { data: { identifier: b.handle, password: PASSWORD }, headers: h });
      await api.put(`/api/v1/mail/${th.id}/mute`, { data: {}, headers: h });
      await page.goto('/mail');
      await expect(page.getByText('Muted', { exact: true })).toBeVisible();
      await scan(page, `the inbox with a muted conversation (${theme})`);
      for (const path of ['/people', `/people/${a.handle}`, '/boards/bulletins', '/boards/polls', '/notifications']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText('Loading')).toHaveCount(0);
        await scan(page, `${path} (${theme})`);
      }
    });

    test('a signed-in user: home, settings', async ({ page, isMobile }) => {
      await useTheme(page, theme);
      const u = await makeUser(page);
      await signIn(page, u.handle, PASSWORD);
      await scan(page, `home (${theme})`);
      for (const tab of ['profile', 'password', 'two-factor', 'terminal', 'data', 'blocked', 'appearance', 'notifications', 'chat', 'boards']) {
        await page.goto(`/settings/${tab}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
        await scan(page, `settings/${tab} (${theme})`);
      }
      if (!isMobile) {
        await page.goto('/');
        await page.getByRole('button', { name: 'Open Settings' }).click();
        await expect(page.getByRole('dialog', { name: 'Settings window' })).toBeVisible();
        await scan(page, `a settings window (${theme})`);
      }
    });

    test('the admin console', async ({ page }) => {
      await useTheme(page, theme);
      const admin = await makeAdmin(page);
      await signIn(page, admin.handle, PASSWORD, { recovery: admin.recoveryCodes[0]! });
      const target = await makeUser(page);
      for (const path of ['/admin/status', '/admin/legal', '/admin/backups', '/admin/users', '/admin/invites', '/admin/audit']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: 'Admin console' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Admin console' })).toBeVisible();
        await scan(page, `${path} (${theme})`);
      }
      await page.goto('/admin/users');
      await page.getByLabel('Search users').fill(target.handle);
      await page.getByRole('link', { name: target.handle }).click();
      await expect(page.getByRole('heading', { level: 2 })).toContainText(target.handle);
      await scan(page, `a user's dossier (${theme})`);
    });

    test('two-factor setup and its recovery codes', async ({ page }) => {
      await useTheme(page, theme);
      const admin = await makeAdmin(page, { withTotp: false });
      await loginViaUi(page, admin.handle, PASSWORD); // held at setup, so there is no account menu to wait for
      await expect(page).toHaveURL(/\/setup-2fa$/);
      await expect(page.getByAltText('QR code for your authenticator app')).toBeVisible();
      await scan(page, `two-factor setup (${theme})`);
    });
  });
}
