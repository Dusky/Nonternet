import { copyFile, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { parse } from 'yaml';
import { readExisting } from '../apply';
import type { Probes } from '../checks';
import { envGet } from '../envfile';
import { Wizard } from './Wizard';
import { banner } from './ui';

// The wizard, driven by keys the way a person would (docs/19).
const DEPLOY = resolve(__dirname, '../../../../deploy');
const KEY = { enter: '\r', tab: '\t', esc: '\u001b', down: '\u001b[B', up: '\u001b[A' };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const probes: Probes = {
  cpus: () => 4, memoryBytes: () => 8 * 1024 ** 3, diskFreeBytes: async () => 200 * 1024 ** 3,
  docker: () => ({ docker: '27.3.1', compose: '2.29.7' }), portFree: async () => true,
  resolve: async () => ['203.0.113.7'], publicIp: async () => '203.0.113.7', smtpGreets: async () => true,
};
let n = 0;
const rand = (bytes: number) => Buffer.from(Array.from({ length: bytes }, () => (n++ * 53 + 7) % 256));

async function deployDir() {
  const dir = await mkdtemp(join(tmpdir(), 'wizard-'));
  await copyFile(join(DEPLOY, '.env.example'), join(dir, '.env.example'));
  await copyFile(join(DEPLOY, 'site.example.yaml'), join(dir, 'site.example.yaml'));
  return dir;
}

async function typeText(stdin: { write: (s: string) => void }, text: string) { for (const ch of text) { stdin.write(ch); await tick(2); } await tick(); }
async function press(stdin: { write: (s: string) => void }, key: string, times = 1) { for (let i = 0; i < times; i++) { stdin.write(key); await tick(); } }
async function waitFor(frame: () => string | undefined, text: string, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (frame()?.includes(text)) return; await tick(20); }
  throw new Error(`never showed "${text}". Last frame:\n${frame()}`);
}

describe('the install wizard', () => {
  it('walks through every step, stops on mistakes, writes the files, and asks for the keys to be saved', async () => {
    const dir = await deployDir();
    let code: number | null = null;
    const { stdin, lastFrame, unmount } = render(<Wizard deployDir={dir} hostDeployDir="/srv/site/deploy" probes={probes} rand={rand} existing={await readExisting(dir)} onDone={(c) => { code = c; }} />);
    await waitFor(lastFrame, 'This sets up the site');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Web and chat');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Name and addresses');
    await press(stdin, KEY.enter); // nothing filled in: it stays and says what is wrong
    await waitFor(lastFrame, 'a domain like example.net');
    await typeText(stdin, 'Test Place');
    await press(stdin, KEY.tab, 2);
    await typeText(stdin, 'test-place.net');
    await press(stdin, KEY.tab);
    await typeText(stdin, 'homes.test-place.net'); // under the site's own domain: refused
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'separate domain of their own');
    for (let i = 0; i < 'homes.test-place.net'.length; i++) stdin.write('\u007f');
    await tick();
    await typeText(stdin, 'test-homes.net');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Who can join');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Outgoing mail');
    await typeText(stdin, 'smtp://u:p@mail.test-place.net:587');
    await press(stdin, KEY.tab);
    await typeText(stdin, 'hello@test-place.net');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'The first admin');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Backups');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Extras');
    await press(stdin, KEY.down, 4); // to "Automatic security updates"
    await press(stdin, ' ');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'the mail server answers');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Ready to write');
    await waitFor(lastFrame, 'install/host-setup.sh');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Keep a copy of these');
    const env = await readFile(join(dir, '.env'), 'utf8');
    expect(lastFrame()).toContain(`BACKUP_KEY=${envGet(env, 'BACKUP_KEY')}`);
    await press(stdin, KEY.enter); // not yet: "saved" has to be typed
    expect(lastFrame()).toContain('Keep a copy of these');
    await typeText(stdin, 'saved');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'Written');
    expect(lastFrame()).toContain('open the link printed below');
    expect((await readFile(join(dir, 'install', 'setup-url'), 'utf8')).trim()).toBe(`https://test-place.net/setup?token=${envGet(env, 'SETUP_TOKEN')}`);
    await press(stdin, KEY.enter);
    expect(code).toBe(0);
    unmount();
    const site = parse(await readFile(join(dir, 'site.yaml'), 'utf8'));
    expect(site.site).toMatchObject({ name: 'Test Place', short_name: 'test-place', domain: 'test-place.net', homes_domain: 'test-homes.net' });
    expect(await readFile(join(dir, 'install', 'host-setup.sh'), 'utf8')).toContain('unattended-upgrades');
    expect(parse(await readFile(join(dir, 'install', 'answers.used.yaml'), 'utf8')).site.domain).toBe('test-place.net');
  });

  it('on a dry run goes through the steps and writes nothing', async () => {
    const dir = await deployDir();
    let code: number | null = null;
    const previous = { site: { name: 'Again', short_name: 'again', domain: 'again.net', homes_domain: 'again-homes.net' }, mail: { smtp_url: 'smtp://m.again.net:587', from: 'a@again.net' } };
    const { stdin, lastFrame, unmount } = render(<Wizard deployDir={dir} hostDeployDir={dir} probes={probes} rand={rand} existing={await readExisting(dir)} previous={previous} dryRun onDone={(c) => { code = c; }} />);
    await waitFor(lastFrame, 'Dry run');
    for (const want of ['Web and chat', 'Name and addresses', 'Who can join', 'Outgoing mail', 'The first admin', 'Backups', 'Extras', 'Checking this server']) { await press(stdin, KEY.enter); await waitFor(lastFrame, want); }
    await waitFor(lastFrame, 'the mail server answers');
    await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'What would change (dry run)');
    await waitFor(lastFrame, '.env');
    await press(stdin, KEY.enter);
    expect(code).toBe(0);
    unmount();
    expect((await readdir(dir)).sort()).toEqual(['.env.example', 'site.example.yaml']);
  });

  it('will not go on past a failed check unless asked to', async () => {
    const dir = await deployDir();
    const previous = { site: { name: 'X', short_name: 'xsite', domain: 'x-site.net', homes_domain: 'x-homes.net' }, mail: { smtp_url: 'smtp://m.x-site.net:587', from: 'a@x-site.net' } };
    const { stdin, lastFrame, unmount } = render(<Wizard deployDir={dir} hostDeployDir={dir} probes={{ ...probes, portFree: async (p) => p !== 80 }} rand={rand} existing={await readExisting(dir)} previous={previous} onDone={() => undefined} />);
    for (let i = 0; i < 9; i++) await press(stdin, KEY.enter);
    await waitFor(lastFrame, 'port 80 is in use');
    await press(stdin, KEY.enter);
    expect(lastFrame()).toContain('F install anyway');
    await press(stdin, 'f');
    await waitFor(lastFrame, 'Ready to write');
    unmount();
  });
});

describe('the banner font', () => {
  it('draws three rows for any name and leaves unknown characters blank', () => {
    const rows = banner('Hi!');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('█');
  });
});
