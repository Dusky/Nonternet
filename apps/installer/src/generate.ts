import { parseDocument } from 'yaml';
import { siteConfigSchema } from '@app/shared';
import { portsFor, servicesFor, type Answers } from './answers';
import { envGet, envSet } from './envfile';
import { b64, b64url, hex, vapidKeys, type Random } from './secrets';

// From the answers to the files a site runs on (docs/19). Nothing here touches the disk: it is given what is there now
// (an existing .env and site config, or the examples) and returns what should be there, so the wizard, the headless mode,
// the dry run and the tests all use the same code. Running it again on an installed site changes settings and keeps
// every secret that is already set.

export interface Existing {
  env?: string;          // deploy/.env, when there is one
  site?: string;         // the current site config, when there is one
  envExample: string;    // deploy/.env.example
  siteExample: string;   // deploy/site.example.yaml
  hasAdmin?: boolean;    // a site that already has an admin needs no setup link
}
export interface FileOut { path: string; content: string; mode?: number; why: string }
export type Step = 'host-setup' | 'cron' | 'up' | 'admin-cli' | 'agent' | 'wiki-starter' | 'demo' | 'doctor';
export interface Plan {
  files: FileOut[];
  steps: Step[];
  made: string[];                     // secrets made now (names only), to show once and say "keep a copy"
  setupUrl: string | null;            // the web finish, when the first admin is made in the browser
  dns: { name: string; type: string; value: string }[];
  ports: { port: number; what: string }[];
  warnings: string[];
}

const SITE_CONFIG = 'site.yaml';

export function plan(a: Answers, now: Existing, rand: Random, hostDeployDir: string): Plan {
  const services = servicesFor(a);
  const ports = portsFor(services, a.ports.bbs_ssh_public);
  const made: string[] = [];
  const warnings: string[] = [];
  let env = now.env ?? now.envExample;
  const keep = (key: string, fresh: () => string, bad: string[] = []) => {
    const cur = envGet(env, key);
    if (cur && !bad.includes(cur)) return cur;
    const v = fresh();
    env = envSet(env, key, v);
    made.push(key);
    return v;
  };

  // Secrets: made once, never replaced on a re-run.
  keep('POSTGRES_PASSWORD', () => hex(rand, 24), ['change-me']);
  keep('DB_RUNTIME_PASSWORD', () => hex(rand, 24));
  keep('APP_SECRET_KEY', () => b64(rand, 32));
  keep('IRC_SECRET', () => b64(rand, 32));
  keep('MUD_SECRET', () => b64(rand, 32));
  keep('BBS_SECRET', () => b64(rand, 32));
  keep('TLS_ASK_SECRET', () => hex(rand, 32));
  keep('BACKUP_KEY', () => b64(rand, 32));
  if (!envGet(env, 'VAPID_PUBLIC_KEY') || !envGet(env, 'VAPID_PRIVATE_KEY')) {
    const k = vapidKeys(rand);
    env = envSet(env, 'VAPID_PUBLIC_KEY', k.publicKey);
    env = envSet(env, 'VAPID_PRIVATE_KEY', k.privateKey);
    made.push('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY');
  }
  let setupUrl: string | null = null;
  if (a.admin.via === 'web' && !now.hasAdmin) {
    const token = keep('SETUP_TOKEN', () => b64url(rand, 32));
    setupUrl = `https://${a.site.domain}/setup?token=${token}`;
  }

  // Settings: these follow the answers every time.
  for (const [k, v] of Object.entries({
    SITE_CONFIG_FILE: `./${SITE_CONFIG}`,
    PUBLIC_URL: `https://${a.site.domain}`,
    CADDY_ADDRESS: a.site.domain,
    SITE_DOMAIN: a.site.domain,
    HOMES_DOMAIN: a.site.homes_domain,
    SMTP_URL: a.mail.smtp_url,
    MAIL_FROM: a.mail.from,
    BBS_SSH_PUBLIC_PORT: String(a.ports.bbs_ssh_public),
  })) env = envSet(env, k, v);
  if (a.backups.to === 's3' && a.backups.s3) {
    env = envSet(env, 'BACKUP_S3_ENDPOINT', a.backups.s3.endpoint);
    env = envSet(env, 'BACKUP_S3_BUCKET', a.backups.s3.bucket);
    env = envSet(env, 'BACKUP_S3_REGION', a.backups.s3.region);
    if (a.backups.s3.access_key_id) env = envSet(env, 'BACKUP_S3_ACCESS_KEY_ID', a.backups.s3.access_key_id);
    if (a.backups.s3.secret_access_key) env = envSet(env, 'BACKUP_S3_SECRET_ACCESS_KEY', a.backups.s3.secret_access_key);
    if (!envGet(env, 'BACKUP_S3_ACCESS_KEY_ID') || !envGet(env, 'BACKUP_S3_SECRET_ACCESS_KEY')) warnings.push('Add BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY to .env, or off-site copies will fail.');
  }
  if (a.backups.to === 'rsync' && a.backups.rsync_target) env = envSet(env, 'BACKUP_RSYNC_TARGET', a.backups.rsync_target);

  // The site config: the example (with its explanations) or the current one, with the answers set into it. Keys the
  // installer does not ask about (door games, OIDC clients, wallpapers…) are left as they are.
  const doc = parseDocument(now.site ?? now.siteExample);
  if (doc.errors.length) throw new Error(`The current site config has a mistake, so the installer leaves it alone: ${doc.errors[0]!.message.split('\n')[0]}`);
  const set = (path: (string | number)[], v: unknown) => doc.setIn(path, v);
  set(['site', 'name'], a.site.name);
  set(['site', 'short_name'], a.site.short_name);
  set(['site', 'domain'], a.site.domain);
  set(['site', 'homes_domain'], a.site.homes_domain);
  set(['signup', 'mode'], a.signup.mode);
  set(['signup', 'minimum_age'], a.signup.minimum_age);
  set(['limits', 'homepage_quota_mb', 'user'], a.limits.homepage_quota_mb);
  set(['limits', 'homepage_quota_mb', 'trusted'], a.limits.homepage_quota_mb * 2);
  set(['limits', 'file_quota_mb'], a.limits.file_quota_mb);
  set(['limits', 'file_max_mb'], a.limits.file_max_mb);
  for (const [k, on] of Object.entries(services)) set(['services', k], on);
  set(['bbs', 'host'], a.site.domain);
  set(['bbs', 'telnet_port'], 23);
  set(['bbs', 'ssh_port'], a.ports.bbs_ssh_public);
  for (const [svc, port] of [['gopher', 70], ['finger', 79], ['gemini', 1965]] as const) {
    set([svc, 'host'], a.site.domain);
    set([svc, 'port'], port);
  }
  const siteYaml = doc.toString();
  const parsed = siteConfigSchema.safeParse(doc.toJS());
  if (!parsed.success) throw new Error(`The site config would not be valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);

  const steps: Step[] = [];
  const files: FileOut[] = [
    { path: '.env', content: env.endsWith('\n') ? env : `${env}\n`, mode: 0o600, why: 'secrets and addresses for the services' },
    { path: SITE_CONFIG, content: siteYaml, why: 'the site config: name, domains, services, limits' },
    { path: 'install/crontab', content: crontab(a, hostDeployDir), why: 'nightly backups, certificate reloads, monthly restore tests' },
  ];
  steps.push('cron');
  const host = hostSetup(a, ports);
  if (host) { files.push({ path: 'install/host-setup.sh', content: host, mode: 0o755, why: 'firewall, automatic security updates, fail2ban' }); steps.push('host-setup'); }
  steps.push('up');
  if (a.admin.via === 'cli' && !now.hasAdmin) steps.push('admin-cli');
  if (a.extras.agent) steps.push('agent');
  if (a.extras.wiki_starter) steps.push('wiki-starter');
  if (a.extras.demo) steps.push('demo');
  steps.push('doctor');
  files.push({ path: 'install/steps', content: `${steps.join('\n')}\n`, why: 'what sitectl does after the files are written' });
  if (setupUrl) files.push({ path: 'install/setup-url', content: `${setupUrl}\n`, mode: 0o600, why: 'the one-off link that makes the first admin' });

  const dns = [
    { name: a.site.domain, type: 'A/AAAA', value: 'this server' },
    { name: `*.${a.site.homes_domain}`, type: 'A/AAAA', value: 'this server (wildcard, for homepages)' },
    ...(services.irc ? [{ name: `irc.${a.site.domain}`, type: 'A/AAAA', value: 'this server' }] : []),
  ];
  if (a.extras.demo) warnings.push('Demo content adds made-up people and posts. Use it on a staging site, not the real one.');
  if (services.bbs && a.ports.bbs_ssh_public === 22) warnings.push('The BBS takes port 22: move the server’s own SSH to another port first, or you will lock yourself out.');
  return { files, steps, made, setupUrl, dns, ports, warnings };
}

// Lines sitectl puts in the crontab between markers, replacing the block on each run.
export function crontab(a: Answers, dir: string): string {
  const d = dir.replace(/'/g, '');
  const cd = `cd '${d}' &&`;
  const h = a.backups.hour;
  const lines = [
    `${15} ${h} * * *  ${cd} ./sitectl backup >> backups/backup.log 2>&1`,
    `30 4 * * 1  ${cd} ./sitectl tls-reload`,
    `45 4 1 * *  ${cd} ./sitectl restore-test >> backups/restore.log 2>&1`,
    `50 ${h} * * *  ${cd} find backups -maxdepth 1 -name '20*' -mtime +${a.backups.keep_days} -delete`,
  ];
  if (a.backups.to !== 'local') lines.push(`5 ${(h + 1) % 24} * * *  ${cd} ./sitectl backup-copy >> backups/copy.log 2>&1`);
  return `${lines.join('\n')}\n`;
}

// A script for what needs root on the host. Shown in the dry run; sitectl runs it with sudo only if it was chosen.
export function hostSetup(a: Answers, ports: { port: number; what: string }[]): string | null {
  const { firewall, unattended_upgrades: upgrades, fail2ban } = a.extras;
  if (!firewall && !upgrades && !fail2ban) return null;
  const out = ['#!/usr/bin/env bash', '# Made by ./sitectl install. Needs root (sitectl runs it with sudo). Debian and Ubuntu.', 'set -euo pipefail', 'export DEBIAN_FRONTEND=noninteractive', 'apt-get update -q'];
  if (firewall) {
    out.push('apt-get install -yq ufw', '# Keep the server\'s own SSH open before anything else.', 'ufw allow OpenSSH');
    for (const p of ports) out.push(`ufw allow ${p.port}/tcp comment '${p.what.replace(/'/g, '')}'`);
    out.push('ufw --force enable');
  }
  if (upgrades) out.push('apt-get install -yq unattended-upgrades', 'dpkg-reconfigure -f noninteractive unattended-upgrades');
  if (fail2ban) out.push('apt-get install -yq fail2ban', 'systemctl enable --now fail2ban');
  out.push('echo "Host setup done."');
  return `${out.join('\n')}\n`;
}
