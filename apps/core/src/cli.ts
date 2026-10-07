import { randomBytes } from 'node:crypto';
import { handleSchema, isReservedHandle, passwordSchema } from '@app/shared';
import { z } from 'zod';
import { createAdmin, resetTotp } from './accounts';
import { depsFromEnv } from './env';
import { newVapidKeys } from './push';
import { migrate } from './migrate';
import { parseBackupKey, restoreTest, runBackup } from './backup';
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { loadSiteConfig } from './config';
import { seedDemo } from './demo';
import { renderErgoConfig } from './irc/render';
import { addStarterPages, adminByHandle } from './wiki-starter';
import { ircSecrets } from './irc/secrets';

// Run it before Ergo starts (the compose file does, in a one-shot service). With IRC_HISTORY_DATABASE_URL it
// also makes Ergo's history database if it doesn't exist yet (Q9); otherwise it needs no database.
//   IRC_CORE_URL (default http://core:3000), IRC_AUTH_SCRIPT (default /config/auth.sh),
//   IRC_TLS_CERT + IRC_TLS_KEY to listen for native clients with TLS on irc.public_port.
//   IRC_LISTEN (:6667), IRC_WS_LISTEN (:8097), IRC_API_LISTEN (:8089), IRC_DATASTORE (/ircd/ircd.db) move things.
async function ensureDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`IRC_HISTORY_DATABASE_URL: the database name must be lowercase letters, digits and _`);
  const server = new URL(url); server.pathname = '/postgres';
  const c = new pg.Client({ connectionString: server.toString() });
  await c.connect();
  try {
    if (!(await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount) { await c.query(`CREATE DATABASE ${name}`); console.log(`Made the database ${name}.`); }
  } finally { await c.end(); }
}

async function writeIrcConfig() {
  const env = process.env;
  const out = arg('out');
  if (!out) throw new Error('--out is required');
  if (!env.IRC_SECRET) throw new Error('IRC_SECRET is required');
  const cfg = loadSiteConfig(env.SITE_CONFIG);
  const publicUrl = (env.PUBLIC_URL ?? `https://${cfg.site.domain}`).replace(/\/$/, '');
  const origins = [...new Set([new URL(publicUrl).origin, `https://${cfg.site.domain}`])];
  if (env.IRC_HISTORY_DATABASE_URL) await ensureDatabase(env.IRC_HISTORY_DATABASE_URL);
  writeFileSync(out, renderErgoConfig(cfg, {
    secrets: ircSecrets(env.IRC_SECRET),
    coreUrl: env.IRC_CORE_URL ?? 'http://core:3000',
    authScript: env.IRC_AUTH_SCRIPT ?? '/config/auth.sh',
    plainListen: env.IRC_LISTEN ?? ':6667', websocketListen: env.IRC_WS_LISTEN ?? ':8097', apiListen: env.IRC_API_LISTEN ?? ':8089',
    websocketOrigins: origins,
    tls: env.IRC_TLS_CERT && env.IRC_TLS_KEY ? { listen: `:${cfg.irc.public_port}`, cert: env.IRC_TLS_CERT, key: env.IRC_TLS_KEY } : undefined,
    datastore: env.IRC_DATASTORE ?? '/ircd/ircd.db',
    historyDatabaseUrl: env.IRC_HISTORY_DATABASE_URL || undefined,
  }), { mode: 0o600 });
  console.log(`Wrote ${out}.`);
}

// Operator commands, run on the server:
//   cli create-admin --handle <handle> --email <email>     (password from ADMIN_PASSWORD, or generated and printed once)
//   cli reset-totp --handle <handle>                       (an admin who lost their authenticator)
//   cli backup --dir <dir>                                 (encrypted database, homepage files and config; needs BACKUP_KEY)
//   cli restore-test --dir <dir>                           (brings the newest backup back into a scratch database and checks it)
//   cli seed-demo [--url http://127.0.0.1:3000]           (a small demo community to look at; not in production; core must be running)
//   cli wiki-starter --as <admin handle>                 (adds the starter help pages to the site wiki; keeps pages already there)
//   cli backup-key                                         (prints a new BACKUP_KEY)
//   cli vapid-keys                                         (prints a new pair of push notification keys for .env)
//   cli irc-config --out <file>                            (writes Ergo's config from the site config; needs IRC_SECRET)
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command === 'irc-config') return writeIrcConfig();
  if (command === 'vapid-keys') {
    const k = newVapidKeys();
    console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
    return;
  }
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
      console.log('Two-factor sign-in is recommended: set it up under Settings, Two-factor (the console can require it for admins).');
    } else if (command === 'seed-demo') {
      // A small community to look at (docs/19): needs a running core to talk to (--url, default http://127.0.0.1:3000).
      const r = await seedDemo(deps, arg('url') ?? 'http://127.0.0.1:3000');
      console.log(r.created.length ? `Made ${r.created.join(', ')}. Everyone signs in with the password "${r.password}".` : 'The demo people already exist; nothing was added.');
    } else if (command === 'wiki-starter') {
      // The starter help pages for the site wiki (docs/20), credited to the admin named by --as. Pages already there are kept.
      const as = arg('as');
      if (!as) throw new Error('--as <admin handle> is required');
      const added = await addStarterPages(deps, await adminByHandle(deps, as), 'cli');
      console.log(added.length ? `Added ${added.join(', ')}.` : 'The starter pages are all there already; nothing was added.');
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
      const opts = { dir, key: parseBackupKey(process.env.BACKUP_KEY), databaseUrl: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL!, mudDatabaseUrl: process.env.MUD_DATABASE_URL || undefined, ircHistoryDatabaseUrl: process.env.IRC_HISTORY_DATABASE_URL || undefined, configFile: process.env.SITE_CONFIG, log: console.log };
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
      throw new Error('Usage: cli create-admin --handle <h> --email <e> | reset-totp --handle <h> | backup --dir <d> | restore-test --dir <d> | seed-demo | wiki-starter --as <admin> | backup-key');
    }
  } finally {
    await deps.db.end();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
