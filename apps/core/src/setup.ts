import { timingSafeEqual, createHash } from 'node:crypto';
import { emailSchema, handleSchema, isReservedHandle, passwordSchema } from '@app/shared';
import { z } from 'zod';
import { audit } from './audit';
import { login, type Ctx } from './accounts';
import { newId } from './crypto';
import { emit } from './events';
import { hashPassword } from './passwords';
import type { AppDeps } from './deps';
import { ApiError } from './errors';

// The web finish of the installer (docs/19): the installer puts a one-off SETUP_TOKEN in .env and prints a link with it.
// Whoever opens that link may create the first admin, once. When any admin exists, setup is closed for good and the token
// does nothing, so a forgotten token is harmless after the first sign-in. Without a token, admins are made with the CLI.
export const setupInputSchema = z.object({
  token: z.string().min(1).max(200),
  handle: handleSchema,
  email: emailSchema,
  password: passwordSchema,
});

async function hasAdmin(deps: AppDeps): Promise<boolean> {
  return (await deps.db.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`)).rowCount === 1;
}

// Compared as hashes, so the comparison takes the same time whatever was sent.
function tokenMatches(expected: string, given: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

export async function setupStatus(deps: AppDeps): Promise<{ needed: boolean }> {
  return { needed: Boolean(deps.setupToken) && !(await hasAdmin(deps)) };
}

export async function finishSetup(deps: AppDeps, input: z.infer<typeof setupInputSchema>, ctx: Ctx): Promise<{ token: string }> {
  if (!deps.setupToken || (await hasAdmin(deps))) throw new ApiError(410, 'setup_closed', 'This site is already set up. Sign in instead.');
  if (!tokenMatches(deps.setupToken, input.token)) throw new ApiError(403, 'bad_setup_token', 'That setup link is not right. Use the one the installer printed.');
  if (isReservedHandle(input.handle, deps.config.site.short_name)) throw new ApiError(400, 'reserved_handle', 'That handle is kept for the site. Choose another.');
  // One admin only, even if two people press the button at once: the lock makes the second wait, then it finds an admin.
  const id = newId('u');
  const passwordHash = await hashPassword(input.password);
  await deps.db.tx(async (q) => {
    await q.query(`SELECT pg_advisory_xact_lock(hashtext('first-admin'))`);
    if ((await q.query(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`)).rowCount) throw new ApiError(410, 'setup_closed', 'This site is already set up. Sign in instead.');
    await q.query(`INSERT INTO users (id, handle, email, email_verified_at, password_hash, role, role_rev) VALUES ($1, $2, $3, now(), $4, 'admin', 1)`, [id, input.handle, input.email, passwordHash]);
    await audit(q, { actorId: id, actorKind: 'user', action: 'site.setup_finished', targetType: 'user', targetId: id, after: { handle: input.handle, role: 'admin' }, origin: 'web', ipHash: ctx.ipHash });
    await emit(q, 'user.created', { user_id: id, handle: input.handle, role: 'admin' });
  });
  const { token } = await login(deps, { identifier: input.handle, password: input.password }, ctx);
  return { token };
}
