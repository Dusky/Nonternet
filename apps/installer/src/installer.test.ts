import { mkdtemp, readFile, writeFile, copyFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { siteConfigSchema } from '@app/shared';
import { answersSchema, servicesFor, type AnswersInput } from './answers';
import { envGet, envSet } from './envfile';
import { plan } from './generate';
import { maskSecrets } from './apply';
import { runChecks, worst, type Probes } from './checks';
import { headless } from './headless';

const DEPLOY = resolve(__dirname, '../../../deploy');
const fixedRandom = () => { let n = 0; return (bytes: number) => Buffer.from(Array.from({ length: bytes }, () => (n++ * 37 + 11) % 256)); };
const base: AnswersInput = {
  profile: 'web-chat',
  site: { name: 'Test Place', short_name: 'testplace', domain: 'test-place.net', homes_domain: 'test-homes.net' },
  mail: { smtp_url: 'smtp://u:p@mail.test-place.net:587', from: 'hello@test-place.net' },
};
const answers = (o: Partial<AnswersInput> = {}) => answersSchema.parse({ ...base, ...o });
const examples = async () => ({ envExample: await readFile(join(DEPLOY, '.env.example'), 'utf8'), siteExample: await readFile(join(DEPLOY, 'site.example.yaml'), 'utf8') });
const file = (p: ReturnType<typeof plan>, path: string) => p.files.find((f) => f.path === path)?.content ?? '';
// Everything sitectl doctor insists on (deploy/sitectl).
const DOCTOR_KEYS = ['POSTGRES_PASSWORD', 'APP_SECRET_KEY', 'IRC_SECRET', 'MUD_SECRET', 'BBS_SECRET', 'SITE_DOMAIN', 'HOMES_DOMAIN', 'DB_RUNTIME_PASSWORD', 'TLS_ASK_SECRET', 'BACKUP_KEY', 'SMTP_URL', 'MAIL_FROM', 'SITE_CONFIG_FILE'];

describe('answers', () => {
  it('want a separate homepage domain, not a name under the site', () => {
    expect(answersSchema.safeParse({ ...base, site: { ...base.site, homes_domain: 'homes.test-place.net' } }).success).toBe(false);
    expect(answersSchema.safeParse({ ...base, site: { ...base.site, homes_domain: 'test-place.net' } }).success).toBe(false);
    expect(answersSchema.safeParse({ ...base, site: { ...base.site, domain: 'not a domain' } }).success).toBe(false);
  });
  it('turn services on by profile, and take each choice in custom', () => {
    expect(servicesFor(answers({ profile: 'web' }))).toMatchObject({ irc: false, bbs: false });
    expect(Object.values(servicesFor(answers({ profile: 'everything' }))).every(Boolean)).toBe(true);
    expect(servicesFor(answers({ profile: 'custom', services: { bbs: true, irc: false } }))).toMatchObject({ bbs: true, irc: false, mud: false });
    expect(answersSchema.safeParse({ ...base, backups: { to: 'rsync' } }).success).toBe(false); // needs a target
  });
});

describe('.env editing', () => {
  it('changes a key in place, uncomments a commented one (its note on the line above), and adds a new one at the end', () => {
    let t = '# top\nA=1\n# B=example          # a note\n';
    t = envSet(t, 'A', '2');
    t = envSet(t, 'B', 'x');
    t = envSet(t, 'C', 'y');
    expect(t).toBe('# top\nA=2\n# a note\nB=x\nC=y\n');
    expect(envGet(t, 'B')).toBe('x');
    expect(() => envSet(t, 'D', 'two\nlines')).toThrow();
  });
});

describe('the plan for a new site', () => {
  it('makes every secret, fills every value doctor checks, and writes a valid site config that keeps the example’s notes', async () => {
    const p = plan(answers(), await examples(), fixedRandom(), '/srv/site/deploy');
    const env = file(p, '.env');
    for (const k of DOCTOR_KEYS) expect(envGet(env, k), k).toBeTruthy();
    for (const k of ['APP_SECRET_KEY', 'IRC_SECRET', 'MUD_SECRET', 'BBS_SECRET', 'TLS_ASK_SECRET']) expect(envGet(env, k)!.length).toBeGreaterThanOrEqual(32);
    expect(envGet(env, 'POSTGRES_PASSWORD')).toMatch(/^[0-9a-f]{48}$/);
    expect(envGet(env, 'VAPID_PUBLIC_KEY')).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(envGet(env, 'SETUP_TOKEN')).toBeTruthy();
    expect(p.setupUrl).toBe(`https://test-place.net/setup?token=${envGet(env, 'SETUP_TOKEN')}`);
    expect(p.made).toContain('BACKUP_KEY');
    const site = file(p, 'site.yaml');
    const cfg = siteConfigSchema.parse(parse(site));
    expect(cfg.site).toMatchObject({ name: 'Test Place', domain: 'test-place.net', homes_domain: 'test-homes.net' });
    expect(cfg.services).toMatchObject({ irc: true, bbs: false, mud: false, gopher: false });
    expect(site).toContain('# Door games'); // the example's explanations are still there
    expect(p.files.find((f) => f.path === '.env')!.mode).toBe(0o600);
    expect(p.steps).toEqual(['cron', 'up', 'agent', 'wiki-starter', 'doctor']);
    expect(file(p, 'install/crontab')).toContain("cd '/srv/site/deploy' && ./sitectl backup");
    expect(p.dns.map((d) => d.name)).toEqual(['test-place.net', '*.test-homes.net', 'irc.test-place.net']);
  });

  it('gives every profile a site config and .env that pass the same checks', async () => {
    for (const profile of ['web', 'web-chat', 'everything', 'custom'] as const) {
      const p = plan(answers({ profile }), await examples(), fixedRandom(), '/d');
      siteConfigSchema.parse(parse(file(p, 'site.yaml')));
      for (const k of DOCTOR_KEYS) expect(envGet(file(p, '.env'), k), `${profile} ${k}`).toBeTruthy();
    }
  });

  it('writes a host script only for the extras that need root, opening only this site’s ports', async () => {
    const none = plan(answers(), await examples(), fixedRandom(), '/d');
    expect(none.files.some((f) => f.path === 'install/host-setup.sh')).toBe(false);
    const p = plan(answers({ profile: 'everything', extras: { firewall: true, fail2ban: true } }), await examples(), fixedRandom(), '/d');
    const sh = file(p, 'install/host-setup.sh');
    expect(sh).toContain('ufw allow OpenSSH');
    for (const port of [80, 443, 6697, 23, 2222, 4000, 70, 79, 1965]) expect(sh).toContain(`ufw allow ${port}/tcp`);
    expect(sh).toContain('fail2ban');
    expect(sh).not.toContain('unattended-upgrades');
    expect(p.steps[1]).toBe('host-setup');
  });

  it('warns about the BBS taking port 22 and about demo content', async () => {
    const p = plan(answers({ profile: 'everything', ports: { bbs_ssh_public: 22 }, extras: { demo: true } }), await examples(), fixedRandom(), '/d');
    expect(p.warnings.join(' ')).toMatch(/port 22/);
    expect(p.warnings.join(' ')).toMatch(/staging/);
  });
});

describe('running it again on an installed site', () => {
  it('keeps every secret, changes the settings, and makes no setup link once there is an admin', async () => {
    const ex = await examples();
    const first = plan(answers(), ex, fixedRandom(), '/d');
    const again = plan(answers({ profile: 'everything', signup: { mode: 'open' } }), { ...ex, env: file(first, '.env'), site: file(first, 'site.yaml'), hasAdmin: true }, () => Buffer.alloc(64, 1), '/d');
    for (const k of ['APP_SECRET_KEY', 'BACKUP_KEY', 'POSTGRES_PASSWORD', 'VAPID_PRIVATE_KEY']) expect(envGet(file(again, '.env'), k)).toBe(envGet(file(first, '.env'), k));
    expect(again.made).toEqual([]);
    expect(again.setupUrl).toBeNull();
    const cfg = siteConfigSchema.parse(parse(file(again, 'site.yaml')));
    expect(cfg.signup.mode).toBe('open');
    expect(cfg.services.mud).toBe(true);
  });

  it('keeps settings the installer does not ask about', async () => {
    const ex = await examples();
    const custom = ex.siteExample.replace('  wallpapers: []', '  wallpapers:\n    - { id: dunes, name: Dunes, file: dunes.jpg, fit: cover }').replace('default_wallpaper: dots', 'default_wallpaper: preset:dunes');
    const p = plan(answers(), { ...ex, site: custom }, fixedRandom(), '/d');
    expect(siteConfigSchema.parse(parse(file(p, 'site.yaml'))).ui.default_wallpaper).toBe('preset:dunes');
    expect(() => plan(answers(), { ...ex, site: `${ex.siteExample}\nui:\n  x: 1\n` }, fixedRandom(), '/d')).toThrow(/has a mistake/);
  });
});

describe('masking secrets in a dry run', () => {
  it('hides secret values and the setup token, and keeps the rest readable', () => {
    const m = maskSecrets('SITE_DOMAIN=a.net\nAPP_SECRET_KEY=abcdef\nhttps://a.net/setup?token=xyz123');
    expect(m).toContain('SITE_DOMAIN=a.net');
    expect(m).toContain('APP_SECRET_KEY=•••••• (6 characters)');
    expect(m).not.toContain('abcdef');
    expect(m).not.toContain('xyz123');
  });
});

const probes = (o: Partial<Probes> = {}): Probes => ({
  cpus: () => 4, memoryBytes: () => 8 * 1024 ** 3, diskFreeBytes: async () => 200 * 1024 ** 3,
  docker: () => ({ docker: '27.3.1', compose: '2.29.7' }), portFree: async () => true,
  resolve: async () => ['203.0.113.7'], publicIp: async () => '203.0.113.7', smtpGreets: async () => true, ...o,
});

describe('checks', () => {
  it('pass on a good machine with DNS in place', async () => {
    expect(worst(await runChecks(answers(), probes()))).toBe('ok');
  });
  it('fail on old Compose or a busy port, and warn about DNS that points elsewhere and silent mail', async () => {
    const c = await runChecks(answers(), probes({ docker: () => ({ docker: '24.0.0', compose: '2.20.0' }), portFree: async (p) => p !== 443, resolve: async () => ['198.51.100.1'], smtpGreets: async () => false }));
    expect(c.find((x) => x.id === 'compose')!.level).toBe('fail');
    expect(c.find((x) => x.id === 'port-443')!.level).toBe('fail');
    expect(c.find((x) => x.id === 'dns-test-place.net')!.level).toBe('warn');
    expect(c.find((x) => x.id === 'smtp')!.level).toBe('warn');
  });
  it('do not count the site’s own ports against a reinstall', async () => {
    const c = await runChecks(answers(), probes({ portFree: async () => false }), { reinstall: true });
    expect(c.some((x) => x.id.startsWith('port-'))).toBe(false);
  });
});

describe('the headless install', () => {
  const setup = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'install-'));
    await copyFile(join(DEPLOY, '.env.example'), join(dir, '.env.example'));
    await copyFile(join(DEPLOY, 'site.example.yaml'), join(dir, 'site.example.yaml'));
    const answersFile = join(dir, 'answers.yaml');
    await writeFile(answersFile, (await readFile(join(DEPLOY, 'install.example.yaml'), 'utf8')));
    return { dir, answersFile };
  };
  it('writes nothing on a dry run and shows masked changes', async () => {
    const { dir, answersFile } = await setup();
    const lines: string[] = [];
    expect(await headless({ answersFile, deployDir: dir, hostDeployDir: dir, dryRun: true, force: false, skipChecks: false }, probes(), fixedRandom(), (l) => lines.push(l))).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(['.env.example', 'answers.yaml', 'site.example.yaml']);
    const all = lines.join('\n');
    expect(all).toContain('Dry run: nothing was written.');
    expect(all).toMatch(/APP_SECRET_KEY=•••••• \(\d+ characters\)/);
  });
  it('installs, then on a second run keeps secrets and saves the old files', async () => {
    const { dir, answersFile } = await setup();
    const out: string[] = [];
    expect(await headless({ answersFile, deployDir: dir, hostDeployDir: dir, dryRun: false, force: false, skipChecks: false }, probes(), fixedRandom(), (l) => out.push(l))).toBe(0);
    const env1 = await readFile(join(dir, '.env'), 'utf8');
    expect((await stat(join(dir, '.env'))).mode & 0o777).toBe(0o600);
    expect(out.join('\n')).toContain('make the first admin here');
    await writeFile(answersFile, (await readFile(answersFile, 'utf8')).replace('mode: invite', 'mode: open'));
    expect(await headless({ answersFile, deployDir: dir, hostDeployDir: dir, dryRun: false, force: false, skipChecks: false }, probes({ portFree: async () => false }), () => Buffer.alloc(64, 9), () => undefined)).toBe(0);
    const env2 = await readFile(join(dir, '.env'), 'utf8');
    expect(envGet(env2, 'APP_SECRET_KEY')).toBe(envGet(env1, 'APP_SECRET_KEY'));
    expect(await readFile(join(dir, 'site.yaml'), 'utf8')).toContain('mode: open');
    expect((await readdir(join(dir, 'install', 'previous'))).length).toBe(1);
  });
  it('stops on failed checks unless forced, and on a bad answers file', async () => {
    const { dir, answersFile } = await setup();
    const bad = probes({ docker: () => ({ docker: null, compose: null }) });
    expect(await headless({ answersFile, deployDir: dir, hostDeployDir: dir, dryRun: false, force: false, skipChecks: false }, bad, fixedRandom(), () => undefined)).toBe(1);
    expect(await headless({ answersFile, deployDir: dir, hostDeployDir: dir, dryRun: true, force: true, skipChecks: false }, bad, fixedRandom(), () => undefined)).toBe(0);
    await writeFile(answersFile, 'site: { name: x }\n');
    const lines: string[] = [];
    expect(await headless({ answersFile, deployDir: dir, hostDeployDir: dir, dryRun: true, force: false, skipChecks: false }, probes(), fixedRandom(), (l) => lines.push(l))).toBe(2);
    expect(lines.join('\n')).toContain('The answers file has problems');
  });
});
