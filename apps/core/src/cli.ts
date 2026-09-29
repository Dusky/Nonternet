import { randomBytes } from 'node:crypto';
import { handleSchema, isReservedHandle, passwordSchema } from '@app/shared';
import { z } from 'zod';
import { createAdmin, resetTotp } from './accounts';
import { depsFromEnv } from './env';
import { migrate } from './migrate';

// Operator commands, run on the server:
//   cli create-admin --handle <handle> --email <email>     (password from ADMIN_PASSWORD, or generated and printed once)
//   cli reset-totp --handle <handle>                       (an admin who lost their authenticator)
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const [command] = process.argv.slice(2);
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
    } else {
      throw new Error('Usage: cli create-admin --handle <h> --email <e> | cli reset-totp --handle <h>');
    }
  } finally {
    await deps.db.end();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
