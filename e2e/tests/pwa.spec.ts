import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';
import { SITE_NAME } from '../support/stack';

// The installable app (docs/10): a manifest made from the site config, a service worker that opens the site without a
// connection, and push notifications chosen per device in Settings.

test('the manifest and icons come from the site config, and the site opens offline once visited', async ({ page, context }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(href!)).json();
  expect(manifest).toMatchObject({ name: SITE_NAME, start_url: '/', display: 'standalone' });
  for (const icon of manifest.icons as { src: string }[]) {
    const r = await page.request.get(icon.src);
    expect(r.headers()['content-type'], icon.src).toBe('image/png');
  }

  // The worker installs, keeping the page and its entry files.
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active)), { timeout: 15_000 }).toBe(true);
  await page.reload(); // now under the worker's control
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('link', { name: SITE_NAME }).first()).toBeVisible(); // the site's own page, not the browser's error
  await context.setOffline(false);
});

test('push on this device: turn it on, choose what it hears about, and turn it off', async ({ page, context }) => {
  // A headless browser has no push service to talk to, so the browser's side is played here; core's side is real.
  await context.grantPermissions(['notifications']);
  await page.addInitScript(() => {
    const endpoint = 'https://push.example.test/e2e-device';
    let current: unknown = null;
    const sub = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } }),
      unsubscribe: async () => { current = null; return true; },
    };
    PushManager.prototype.subscribe = async function () { current = sub; return sub as unknown as PushSubscription; };
    PushManager.prototype.getSubscription = async function () { return current as PushSubscription | null; };
  });
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/settings/notifications');
  const devices = async () => (await (await page.request.get('/api/v1/me/push')).json()).devices as { kinds: string[]; label: string }[];

  const on = page.getByRole('switch', { name: 'Push notifications on this device' });
  await on.check();
  await expect(page.getByRole('checkbox', { name: 'Mail' })).toBeChecked();
  expect(await devices()).toEqual([expect.objectContaining({ kinds: ['mail', 'reply', 'mention', 'watch'], label: expect.stringMatching(/ on /) })]);

  await page.getByRole('checkbox', { name: 'Mentions' }).uncheck();
  await expect.poll(async () => (await devices())[0]?.kinds).toEqual(['mail', 'reply', 'watch']);

  await on.uncheck();
  await expect(page.getByRole('checkbox', { name: 'Mail' })).toHaveCount(0);
  expect(await devices()).toEqual([]);
});
