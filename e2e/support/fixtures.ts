import { test as base, expect } from '@playwright/test';

// Every test fails if the page throws an uncaught error or logs one to the console. A blank screen
// after a crash would otherwise look like "the element wasn't found". The browser also logs
// "Failed to load resource" for a 4xx/5xx response; those are expected (logged-out visitors get 401
// from /me) and the tests assert on the visible result of them instead.
export const test = base.extend<{ pageErrors: string[]; seenLookNote: boolean }>({
  // The one-time note about the new look (docs/10) is marked seen so it doesn't sit over other tests;
  // tests of the note itself set this to false.
  seenLookNote: [true, { option: true }],
  context: async ({ context, seenLookNote }, use) => {
    if (seenLookNote) await context.addInitScript(() => { try { localStorage.setItem('ui:seen-look-2026-10', '1'); } catch { /* storage blocked */ } });
    await use(context);
  },
  pageErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await use(errors);
    expect(errors, 'the page must not throw or log errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
