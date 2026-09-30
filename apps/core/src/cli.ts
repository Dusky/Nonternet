import { randomBytes } from 'node:crypto';
import { handleSchema, isReservedHandle, passwordSchema } from '@app/shared';
import { z } from 'zod';
import { createAdmin, resetTotp } from './accounts';
import { depsFromEnv } from './env';
import { migrate } from './migrate';
import { parseBackupKey, restoreTest, runBackup } from './backup';
import { writeFileSync } from 'node:fs';
import { loadSiteConfig } from './config';
import { renderErgoConfig } from './irc/render';
import { ircSecrets } from './irc/secrets';

// Needs no database: run it before Ergo starts (the compose file does, in a one-shot service).
//   IRC_CORE_URL (default http://core:3000), IRC_AUTH_SCRIPT (default /config/auth.sh),
//   IRC_TLS_CERT + IRC_TLS_KEY to listen for native clients with TLS on irc.public_port.
//   IRC_LISTEN (:6667), IRC_WS_LISTEN (:8097), IRC_API_LISTEN (:8089), IRC_DATASTORE (/ircd/ircd.db) move things.
function writeIrcConfig() {
  const env = process.env;
  const out = arg('out');
  if (!out) throw new Error('--out is required');
  if (!env.IRC_SECRET) throw new Error('IRC_SECRET is required');
  const cfg = loadSiteConfig(env.SITE_CONFIG);
  const publicUrl = (env.PUBLIC_URL ?? `https://${cfg.site.domain}`).replace(/\/$/, '');
  const origins = [...new Set([new URL(publicUrl).origin, `https://${cfg.site.domain}`])];
  writeFileSync(out, renderErgoConfig(cfg, {
    secrets: ircSecrets(env.IRC_SECRET),
    coreUrl: env.IRC_CORE_URL ?? 'http://core:3000',
    authScript: env.IRC_AUTH_SCRIPT ?? '/config/auth.sh',
    plainListen: env.IRC_LISTEN ?? ':6667', websocketListen: env.IRC_WS_LISTEN ?? ':8097', apiListen: env.IRC_API_LISTEN ?? ':8089',
    websocketOrigins: origins,
    tls: env.IRC_TLS_CERT && env.IRC_TLS_KEY ? { listen: `:${cfg.irc.public_port}`, cert: env.IRC_TLS_CERT, key: env.IRC_TLS_KEY } : undefined,
    datastore: env.IRC_DATASTORE ?? '/ircd/ircd.db',
  }), { mode: 0o600 });
  console.log(`Wrote ${out}.`);
}

// Operator commands, run on the server:
//   cli create-admin --handle <handle> --email <email>     (password from ADMIN_PASSWORD, or generated and printed once)
//   cli reset-totp --handle <handle>                       (an admin who lost their authenticator)
//   cli backup --dir <dir>                                 (encrypted database, homepage files and config; needs BACKUP_KEY)
//   cli restore-test --dir <dir>                           (brings the newest backup back into a scratch database and checks it)
//   cli backup-key                                         (prints a new BACKUP_KEY)
//   cli irc-config --out <file>                            (writes Ergo's config from the site config; needs IRC_SECRET)
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command === 'irc-config') return writeIrcConfig();
  const deps = depsFromEnv();
  try {
    await migrate(deps.db);
    if (command === 'create-admin') {
      const handle = handleSchema.parse(arg('handle'));
      const email = z.string().email().parse(arg('email'));
      if (isReservedHandle(handle, deps.config.site.short_name)) throw new Error(`"${handle}" is a reserved handle.`);
      const supplied = process.env.ADMIN_PASSWORD;
      const password = passwordSchema.parse(supplied ?? randomBytes(15).toString('base64url'));
      const id = await createAdmin(deps, { handle, email, password });
      console.log(`Created admin ${handle} (${id}).`);
      if (!supplied) console.log(`Password (shown once): ${password}`);
      console.log('On first login the admin is asked to set up two-factor authentication.');
    } else if (command === 'reset-totp') {
      const handle = arg('handle');
      if (!handle) throw new Error('--handle is required');
      await resetTotp(deps, handle);
      console.log(`Two-factor authentication reset for ${handle}. Their sessions were signed out.`);
    } else if (command === 'backup-key') {
      console.log(randomBytes(32).toString('base64'));
    } else if (command === 'backup' || command === 'restore-test') {
      const dir = arg('dir');
      if (!dir) throw new Error('--dir is required');
      const opts = { dir, key: parseBackupKey(process.env.BACKUP_KEY), databaseUrl: process.env.DATABASE_URL!, configFile: process.env.SITE_CONFIG, log: console.log };
      if (command === 'backup') {
        const r = await runBackup(deps, opts);
        console.log(`Backup written: ${r.manifest}`);
      } else {
        const r = await restoreTest(deps, opts);
        for (const c of r.checks) console.log(`${c.ok ? 'ok    ' : 'FAILED'} ${c.name} (expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)})`);
        console.log(r.ok ? 'The newest backup restores correctly.' : 'The restore test FAILED.');
        if (!r.ok) process.exitCode = 1;
      }
    } else {
      throw new Error('Usage: cli create-admin --handle <h> --email <e> | reset-totp --handle <h> | backup --dir <d> | restore-test --dir <d> | backup-key');
    }
  } finally {
    await deps.db.end();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
