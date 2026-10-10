import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import type { Existing, FileOut, Plan } from './generate';

// Reading what is there and writing the plan out. Before a file is replaced, the old one is copied to
// install/previous/<time>/, so a re-run can always be undone by hand.

const read = (p: string) => fs.readFile(p, 'utf8').catch(() => undefined);

export async function readExisting(deployDir: string): Promise<Existing> {
  const env = await read(join(deployDir, '.env'));
  const sitePath = env ? /^SITE_CONFIG_FILE=(.*)$/m.exec(env)?.[1]?.trim() : undefined;
  const site = sitePath && !sitePath.endsWith('site.example.yaml') ? await read(join(deployDir, sitePath)) : await read(join(deployDir, 'site.yaml'));
  return {
    env, site,
    envExample: (await read(join(deployDir, '.env.example'))) ?? '',
    siteExample: (await read(join(deployDir, 'site.example.yaml'))) ?? '',
    hasAdmin: (await read(join(deployDir, 'install', 'has-admin'))) !== undefined, // sitectl writes this when the site already has one
  };
}

export interface Change { path: string; kind: 'new' | 'changed' | 'same'; patch: string; why: string }

// What each file would become. Secrets in .env are masked in the patch so a dry run can be shown or pasted safely.
export async function changes(deployDir: string, p: Plan): Promise<Change[]> {
  const out: Change[] = [];
  for (const f of p.files) {
    const before = await read(join(deployDir, f.path));
    const kind = before === undefined ? 'new' : before === f.content ? 'same' : 'changed';
    const mask = (t: string) => (f.path === '.env' || f.path === 'install/setup-url' ? maskSecrets(t) : t);
    out.push({ path: f.path, kind, why: f.why, patch: kind === 'same' ? '' : createTwoFilesPatch(f.path, f.path, mask(before ?? ''), mask(f.content), kind === 'new' ? 'nothing' : 'now', 'after', { context: 2 }) });
  }
  return out;
}

const SECRET_KEYS = /^(POSTGRES_PASSWORD|DB_RUNTIME_PASSWORD|APP_SECRET_KEY|IRC_SECRET|MUD_SECRET|BBS_SECRET|TLS_ASK_SECRET|BACKUP_KEY|VAPID_PRIVATE_KEY|SETUP_TOKEN|SMTP_URL|BACKUP_S3_SECRET_ACCESS_KEY)=(.+)$/;
export function maskSecrets(text: string): string {
  return text.split('\n').map((l) => {
    const m = SECRET_KEYS.exec(l);
    if (m) return `${m[1]}=•••••• (${m[2]!.length} characters)`;
    return l.replace(/token=[A-Za-z0-9_-]+/, 'token=••••••');
  }).join('\n');
}

export async function writePlan(deployDir: string, p: Plan, stamp = new Date().toISOString().replace(/[:.]/g, '-')): Promise<string[]> {
  const written: string[] = [];
  for (const f of p.files) {
    const target = join(deployDir, f.path);
    const before = await read(target);
    if (before === f.content) continue;
    if (before !== undefined) {
      const keep = join(deployDir, 'install', 'previous', stamp, f.path);
      await fs.mkdir(dirname(keep), { recursive: true });
      await fs.writeFile(keep, before, { mode: 0o600 });
    }
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(`${target}.new`, f.content, { mode: f.mode ?? 0o644 });
    await fs.rename(`${target}.new`, target);
    if (f.mode) await fs.chmod(target, f.mode);
    written.push(f.path);
  }
  return written;
}
export type { FileOut };
