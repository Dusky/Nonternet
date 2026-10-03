import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '../support/fixtures';
import { ROOT, TMP } from '../support/stack';
import { makeAdmin, signIn, totp } from '../support/helpers';

// Updates and restarts from the console (docs/19). The test plays the server's side: it runs the real `sitectl agent`
// against the stack's ops folder, with a stand-in for docker compose.
const ops = join(TMP, 'ops');
const fake = join(TMP, 'fake-compose');
const agent = () => execFileSync('bash', [join(ROOT, 'deploy/sitectl'), 'agent', '--once'], {
  cwd: join(ROOT, 'deploy'), encoding: 'utf8', env: { ...process.env, SITECTL_OPS_DIR: ops, SITECTL_COMPOSE: `bash ${fake}` },
});

test('an admin checks for updates and restarts a service from the console, and reads the log', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one browser is enough: the agent and its folder are shared');
  mkdirSync(ops, { recursive: true });
  writeFileSync(fake, 'echo "compose $*"\n');
  const admin = await makeAdmin(page);
  await signIn(page, admin.handle, admin.password, { totp: await totp(admin.secret, 1) }); // the next step: setup used this one
  agent(); // the agent checks in and reports the running version
  await page.goto('/admin/updates');
  await expect(page.getByRole('heading', { name: 'Updates and restarts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Running version' })).toBeVisible();
  await expect(page.getByText(/Last checked for updates/)).toBeVisible();

  const restart = page.getByRole('region', { name: 'Restart a service' });
  await restart.getByLabel('Service').selectOption('bbs');
  await restart.getByLabel('Your password, to confirm').fill(admin.password);
  await restart.getByRole('button', { name: 'Restart' }).click();
  await expect(restart.getByText('Asked. The job shows below as it runs.')).toBeVisible();
  const jobs = page.getByRole('region', { name: 'Recent jobs' });
  await expect(jobs.getByRole('row', { name: /Restart: bbs.*waiting/ })).toBeVisible();

  agent();
  await expect(jobs.getByRole('row', { name: /Restart: bbs.*done/ })).toBeVisible({ timeout: 15_000 });
  await jobs.getByRole('button', { name: 'Log' }).first().click();
  await expect(page.getByRole('region', { name: 'Recent jobs' }).getByText('compose restart bbs')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});
