import { expect, test } from '../support/fixtures';
import { makeUser, PASSWORD, signIn } from '../support/helpers';

// After a site update a tab still running the old page asks for app files that are gone. That shows an "updated" note with a
// button that reloads the page, not the generic "something went wrong".
// The service worker would answer the request itself, out of reach of the test's route, so it is left out.
test.use({ serviceWorkers: 'block' });

test('an app whose file is gone says the site was updated, and Reload the page brings it back', async ({ page, pageErrors }) => {
  const me = await makeUser(page);
  await signIn(page, me.handle, PASSWORD);
  let gone = true;
  await page.route('**/assets/HomepagesApp-*.js', (route) => (gone ? route.abort() : route.continue()));
  await page.goto('/homepages');
  const note = page.getByRole('alert').filter({ hasText: 'The site was updated while this page was open' });
  await expect(note).toBeVisible();
  await expect(page.getByText('Something went wrong in this app')).toHaveCount(0);
  // The failed import is logged, as it should be; that is what this test makes happen.
  expect(pageErrors.some((e) => /dynamically imported module/.test(e))).toBe(true);
  pageErrors.length = 0;
  gone = false;
  await note.getByRole('button', { name: 'Reload the page' }).click();
  await expect(page.getByRole('search')).toBeVisible();   // the directory's search form
  await expect(page.getByRole('alert').filter({ hasText: 'updated' })).toHaveCount(0);
});
