import net from 'node:net';
import { expect, test } from '../support/fixtures';
import { BBS_TELNET_PORT } from '../support/stack';
import { codeFor, newInvite, uniq } from '../support/helpers';

// Signing up from the terminal (docs/04): a caller types "new" over telnet, signs up with an invite, types the
// emailed code, lands on the BBS menu; then logs in on the website with the website password.
function telnet() {
  const s = net.connect(BBS_TELNET_PORT, '127.0.0.1');
  let text = '';
  s.on('data', (d: Buffer) => {
    const out: number[] = [];
    for (let i = 0; i < d.length; i++) { if (d[i] === 255) { i += d[i + 1] === 250 ? d.indexOf(240, i) - i : 2; continue; } out.push(d[i]!); }
    text += Buffer.from(out).toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  });
  const until = (re: RegExp) => expect.poll(() => re.test(text), { timeout: 10_000, message: `waiting for ${re}` }).toBe(true);
  return { s, until, type: (x: string) => s.write(x), get text() { return text; } };
}

test('a caller signs up from the terminal and then logs in on the website', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one terminal sign-up is enough; the phone part is the web login, covered elsewhere');
  test.setTimeout(60_000);
  const invite = await newInvite();
  const handle = uniq('caller');
  const email = `${handle}@example.test`;
  const t = telnet();
  await t.until(/Handle:/);
  t.type('new\r');
  await t.until(/Read the terms of service first\? \[Y\/N\]/);
  t.type('n');
  await t.until(/Do you agree/);
  t.type('y');
  await t.until(/years old\? \[Y\/N\]/);
  t.type('y');
  await t.until(/Invite code:/);
  t.type(`${invite}\r`);
  await t.until(/Handle \(your name here\):/);
  t.type(`${handle}\r`);
  await t.until(/Email address:/);
  t.type(`${email}\r`);
  await t.until(/Website password:/);
  t.type('website pass 1\rwebsite pass 1\r');
  await t.until(/Terminal password:/);
  t.type('terminal pass 1\rterminal pass 1\r');
  await t.until(/six-digit code/);
  t.type(`${await codeFor(email)}\r`);
  await t.until(/Main menu \[/);
  t.type('g');
  await t.until(/Thanks for calling/);
  t.s.destroy();

  await page.goto('/login');
  await page.getByLabel('Handle or email').fill(handle);
  await page.getByLabel('Password', { exact: true }).fill('website pass 1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('button', { name: `Account menu for ${handle}` })).toBeVisible();
});
