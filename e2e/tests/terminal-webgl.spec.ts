import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// With WebGL available, the Terminal draws with the WebGL renderer, so box and block characters join up (research pick
// 2026-10-18). The rest of the suite runs with WebGL off (playwright.config.ts) so it can read the screen's text.
test.use({ launchOptions: { args: ['--host-resolver-rules=MAP *.e2e-homes.test 127.0.0.1, MAP e2e-homes.test 127.0.0.1', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

test('the Terminal uses the WebGL renderer when the browser has WebGL', async ({ page }) => {
  const hasWebgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  test.skip(!hasWebgl, 'this browser has no WebGL2: the built-in renderer is used, as the rest of the suite checks');
  const u = await makeUser(page);
  await signIn(page, u.handle, PASSWORD);
  await page.goto('/terminal');
  await expect(page.locator('.xterm[data-renderer="webgl"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.xterm canvas').first()).toBeVisible();
});
