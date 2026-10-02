import { expect, test } from '../support/fixtures';

// A visitor who is not signed in should see a quiet browser console: no failing requests on the way in.
test.describe('visitors', () => {
  for (const path of ['/', '/boards', '/login', '/legal/terms']) {
    test(`loading ${path} signed out makes no failing request and logs no errors`, async ({ page }) => {
      const failed: string[] = [];
      const errors: string[] = [];
      page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(failed).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
