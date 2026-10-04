import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { BASE_URL } from '../support/stack';
import { makeAdmin, makeUser, PASSWORD, setRole, signIn, totp, uniq } from '../support/helpers';

// Every option on the BBS main menu, from the Terminal window (docs/04). Each one is opened, used along its main
// path, and left, and the menu must come back. A screen that prints a list waits for a key, so nothing scrolls
// away before it is read; letters at a list prompt act at once, and numbers take Enter.
const h = { origin: BASE_URL };

test('every BBS menu option works from the Terminal window', async ({ page, isMobile }) => {
  test.skip(isMobile, 'one browser is enough; the phone key bar is covered in terminal.spec');
  test.setTimeout(180_000);
  const owner = await makeUser(page, { handle: uniq('ada') });
  await setRole(owner.handle, 'trusted');
  const reader = await makeUser(page, { handle: uniq('lin') });
  const api = page.context().request;
  await api.post('/api/v1/auth/login', { data: { identifier: owner.handle, password: PASSWORD }, headers: h });
  const slug = uniq('synths');
  await api.post('/api/v1/boards', { data: { slug, name: 'Synths', visibility: 'public' }, headers: h });
  const first = await (await api.post(`/api/v1/boards/${slug}/posts`, { data: { subject: 'First synth?', body: 'Mine was a Juno.' }, headers: h })).json();
  await api.post(`/api/v1/boards/${slug}/posts`, { data: { body: 'A Volca Keys.', reply_to: first.id }, headers: h });
  const ring = uniq('lofi');
  await api.post('/api/v1/rings', { data: { slug: ring, name: `Lofi ${ring}`, description: 'Hand-made pages.', tags: ['music'] }, headers: h });
  await api.post('/api/v1/polls', { data: { question: `Best synth ${ring}?`, options: ['Juno-106', 'Volca Keys'] }, headers: h });
  await api.post('/api/v1/mail', { data: { to: [reader.handle], subject: 'Welcome aboard', body: 'Glad you made it.' }, headers: h });
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });
  const admin = await makeAdmin(page);
  await api.post('/api/v1/auth/login', { data: { identifier: admin.handle, password: PASSWORD, totp: await totp(admin.secret, 1) }, headers: h });
  const bulletin = await (await api.post('/api/v1/admin/bulletins', { data: { title: `Server moves ${ring}`, body: 'Short downtime.' }, headers: h })).json();
  await api.post('/api/v1/admin/files/areas', { data: { slug: uniq('tools'), name: `Tools ${ring}`, visibility: 'public', upload_role: 'user' }, headers: h });
  await api.post('/api/v1/auth/logout', { data: {}, headers: h });

  await signIn(page, reader.handle, PASSWORD);
  await page.goto('/terminal');
  const screen = page.locator('.xterm-rows');
  await expect(screen).toContainText('Main menu [', { timeout: 15_000 });
  const term = new Keys(page);

  const backToMenu = async () => {
    await expect(screen).toContainText('Main menu [');
    await expect(screen).not.toContainText(/Something went wrong|not answering/);
  };
  // A long list pages first ("-- press a key --"), then waits for the menu.
  const pauseThenMenu = async () => {
    await expect(screen).toContainText(/press a key/);
    for (let i = 0; i < 20 && !(await screen.innerText()).includes('press a key for the menu'); i++) { await term.type(' '); await page.waitForTimeout(300); }
    await expect(screen).toContainText('press a key for the menu');
    await term.type(' ');
    await backToMenu();
  };
  const row = async (text: string) => (await screen.innerText()).split('\n').find((l) => l.includes(text))!.trim().split(/\s+/)[0]!;

  // Boards: the list lines up (colour codes never cut in half), a thread reads, a reply posts, and P acts at once.
  await term.type('b');
  await expect(screen).toContainText('Board number, New scan, or Q to go back');
  await term.type(`${await row('Synths')}\r`);
  await expect(screen).toContainText('Number to read, Post, All read, Quit');
  await term.type('1\r');
  await expect(screen).toContainText('Mine was a Juno.');
  await term.type('\r');
  await expect(screen).toContainText('A Volca Keys.');
  await term.type('r');
  await expect(screen).toContainText('/s save');
  await term.type('Thanks, from the terminal.\r/s\ry');
  await expect(screen).toContainText('Posted.');
  await term.type('q');
  await term.type('p');
  await expect(screen).toContainText('Subject:');
  await term.type('Terminal topic\rWritten in the terminal.\r/s\ry');
  await expect(screen).toContainText('Posted.');
  await term.type('qq');
  await backToMenu();

  // New messages. The test site is shared, so other tests may have just posted: either it reads them out, or it says
  // there is nothing new and waits for a key.
  await term.type('n');
  await expect(screen).toContainText(/caught up|everything new|new messages/);
  if (/Skip this board, Quit/.test(await screen.innerText())) { await term.type('q'); await backToMenu(); } else await pauseThenMenu();

  // Mail: read the conversation, then write one with W at once.
  await term.type('m');
  await expect(screen).toContainText('Welcome aboard');
  await term.type('1\r');
  await expect(screen).toContainText('Glad you made it.');
  await term.type('q');
  await term.type('w');
  await expect(screen).toContainText('To (handles');
  await term.type(`${owner.handle}\rFrom the BBS\rHello by terminal.\r/s\r`);
  await expect(screen).toContainText('Sent.');
  await term.type('q');
  await backToMenu();

  // Rings: open one and join it.
  await term.type('r');
  await expect(screen).toContainText(`Lofi ${ring}`);
  await term.type(`${await row(`Lofi ${ring}`)}\r`);
  await expect(screen).toContainText('Join');
  await term.type('j');
  await expect(screen).toContainText(`You joined Lofi ${ring}`);
  await term.type('qq');
  await backToMenu();

  // Homepages, Who's online and Last callers: each stays on screen until a key.
  await term.type('h');
  await expect(screen).toContainText('Homepages');
  await term.type('q');
  await backToMenu();
  await term.type('w');
  await expect(screen).toContainText(new RegExp(`${reader.handle}\\s+.*\\(web\\)`));
  await pauseThenMenu();
  await term.type('l');
  await expect(screen).toContainText('Last callers');
  await expect(screen).toContainText(reader.handle);
  await pauseThenMenu();

  // Doors and QWK say what there is and wait.
  await term.type('d');
  await expect(screen).toContainText('Door games');
  await term.type('q');
  await expect(screen).toContainText('Main menu [');
  await term.type('q');
  await expect(screen).toContainText(/Your packet \(.*\.QWK\)/);
  await pauseThenMenu();

  // Oneliners: A adds a line.
  await term.type('o');
  await expect(screen).toContainText('Add a line');
  await term.type('a');
  await expect(screen).toContainText('Your line');
  await term.type('hi from the web terminal\r');
  await expect(screen).toContainText('Up on the wall.');
  await term.type('q');
  await backToMenu();

  // Bulletins: read one.
  await term.type('i');
  await expect(screen).toContainText(`Server moves ${ring}`);
  await term.type(`${bulletin.number}\r`);
  await expect(screen).toContainText('Short downtime.');
  await term.type('q');
  await backToMenu();

  // Voting booth: vote and see the tally.
  await term.type('v');
  await expect(screen).toContainText(`Best synth ${ring}?`);
  await term.type(`${await row(`Best synth ${ring}?`)}\r`);
  await expect(screen).toContainText('Your choice');
  await term.type('1\r');
  await expect(screen).toContainText('<- your vote');
  await term.type('q');
  await backToMenu();

  // File areas: open one.
  await term.type('f');
  await expect(screen).toContainText(`Tools ${ring}`);
  await term.type(`${await row(`Tools ${ring}`)}\r`);
  await expect(screen).toContainText('Nothing here yet.');
  await term.type('q');
  await backToMenu();

  // Settings: shows this terminal and keeps the character set on Enter.
  await term.type('s');
  await expect(screen).toContainText('This terminal:');
  await term.type('\r');
  await pauseThenMenu();

  // The web saw what was done in the terminal.
  const threads = (await (await page.request.get(`/api/v1/boards/${slug}/threads`)).json()).threads as { subject: string }[];
  expect(threads.map((x) => x.subject)).toContain('Terminal topic');
});

// Typing into xterm.js: Enter is pressed as a key, everything else typed.
class Keys {
  constructor(private readonly page: Page) {}
  async type(s: string) {
    await this.page.locator('.xterm-helper-textarea').focus();
    for (const part of s.split(/(\r)/)) {
      if (part === '\r') await this.page.keyboard.press('Enter');
      else if (part) await this.page.keyboard.type(part);
    }
  }
}
