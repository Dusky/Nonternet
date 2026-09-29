import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_SHELL_PORT ?? 4373);

// Every test runs twice: once as a desktop browser, once as a phone. One worker: the tests share
// one database and one running site, and each makes its own users so they don't step on each other.
export default defineConfig({
  testDir: './tests',
  outputDir: './.tmp/results',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: './support/global-setup.ts',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { ...devices['Pixel 5'] } },
  ],
});
