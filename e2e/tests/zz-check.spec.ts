import { test } from '@playwright/test';
import { signIn } from '../support/helpers';
import { cli, CORE_PORT } from '../support/stack';

test('check suspicious clicks', async ({ page, isMobile }) => {
  test.skip(isMobile);
  test.setTimeout(120_000);
  cli(['seed-demo', '--url', `http://127.0.0.1:${CORE_PORT}`]);
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await signIn(page, 'tansy', 'demo walkthrough 1');
  const log = (s: string) => console.log('>>', s);
  // home stats
  await page.goto('/'); await page.waitForTimeout(1500);
  const stat = page.locator('.home-stats button').first();
  log(`stat visible=${await stat.isVisible()} box=${JSON.stringify(await stat.boundingBox())}`);
  try { await stat.click({ timeout: 3000 }); log('stat clicked ok, url ' + page.url()); } catch (e) { log('stat click fail: ' + String(e).split('\n').slice(0, 6).join(' / ')); }
  await page.screenshot({ path: '/tmp/claude-0/-home-user-Nonternet/cd58cdbf-aa47-5bc2-848b-0c8a9e7d9064/scratchpad/check-home.png' });
  // reaction toggle
  const threads = await (await page.request.get('/api/v1/boards/synths/threads')).json();
  await page.goto(`/boards/synths/t/${threads.threads.find((x: any) => x.subject.startsWith('What')).id}`); await page.waitForTimeout(1200);
  const thanks = page.getByRole('button', { name: /Thanks/ }).first();
  log('thanks before: ' + await thanks.textContent() + ' pressed=' + await thanks.getAttribute('aria-pressed'));
  await thanks.click(); await page.waitForTimeout(800);
  log('thanks after: ' + await thanks.textContent() + ' pressed=' + await thanks.getAttribute('aria-pressed'));
  // mail add / mute
  const mail = await (await page.request.get('/api/v1/mail')).json();
  await page.goto(`/mail/${mail.threads[0].id}`); await page.waitForTimeout(1200);
  for (const name of ['Add', 'Mute this conversation']) {
    const b = page.getByRole('button', { name, exact: true }).first();
    log(`${name}: count=${await b.count()} visible=${await b.isVisible().catch(() => false)} disabled=${await b.isDisabled().catch(() => null)}`);
  }
  await page.screenshot({ path: '/tmp/claude-0/-home-user-Nonternet/cd58cdbf-aa47-5bc2-848b-0c8a9e7d9064/scratchpad/check-mail.png', fullPage: true });
  // settings try it
  await page.goto('/settings/notifications'); await page.waitForTimeout(1000);
  const tryIt = page.getByRole('button', { name: 'Try it' }).first();
  log(`try it: count=${await tryIt.count()} visible=${await tryIt.isVisible().catch(() => false)} disabled=${await tryIt.isDisabled().catch(() => null)}`);
  // next unread
  await page.goto('/boards/synths'); await page.waitForTimeout(1000);
  const nu = page.getByRole('button', { name: 'Next unread thread' });
  log(`next unread disabled=${await nu.isDisabled()}`);
  // terminal F1 
  await page.goto('/terminal'); await page.waitForTimeout(2500);
  const f1 = page.getByRole('button', { name: 'F1' });
  log(`F1 count=${await f1.count()} visible=${await f1.isVisible().catch(() => false)}`);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-Nonternet/cd58cdbf-aa47-5bc2-848b-0c8a9e7d9064/scratchpad/check-term.png' });
  // mud log buttons
  await page.goto('/mud'); await page.waitForTimeout(2500);
  const plain = page.getByRole('button', { name: 'As plain text' });
  log(`plain count=${await plain.count()} visible=${await plain.isVisible().catch(() => false)}`);
});
