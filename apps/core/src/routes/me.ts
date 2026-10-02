import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, profileUpdateSchema } from '@app/shared';
import { z } from 'zod';
import * as accounts from '../accounts';
import { createReadStream } from 'node:fs';
import { ctxOf, requireUser } from '../http';
import * as exports_ from '../exports/service';
import * as imports from '../imports';
import { ApiError } from '../errors';
import { deleteOwnAccount } from '../deletion';
import { COOKIE } from '../http';
import type { AppDeps } from '../deps';

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'enter the 6-digit code') });

export function meRoutes(app: FastifyInstance, deps: AppDeps): void {
  // The same answer as /me, but a visitor gets `{ user: null }` with a 200, so loading any public page does not log a failing request.
  app.get('/api/v1/session', async (req) => ({ user: req.session ? accounts.toMe(req.session) : null }));
  app.get('/api/v1/me', async (req) => ({ user: accounts.toMe(requireUser(req, { allowLimited: true })) }));

  app.patch('/api/v1/me', async (req) => {
    const user = requireUser(req);
    await accounts.updateProfile(deps, user, profileUpdateSchema.parse(req.body));
    const fresh = await accounts.resolveSession(deps, req.cookies.sid!);
    return { user: accounts.toMe(fresh!) };
  });

  app.put('/api/v1/me/password', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = changePasswordSchema.parse(req.body);
    await accounts.changePassword(deps, requireUser(req), body.current_password, body.new_password, ctxOf(deps, req), (err) => req.log.error({ err }, 'password-changed email failed'));
    return reply.code(204).send();
  });

  // TOTP setup is open to limited sessions: it is how an admin gets out of that state.
  app.post('/api/v1/me/totp/setup', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) =>
    accounts.totpSetup(deps, requireUser(req, { allowLimited: true })));

  // Returns the recovery codes. They are shown once and never again.
  app.post('/api/v1/me/totp/enable', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { code } = codeSchema.parse(req.body);
    return { recovery_codes: await accounts.totpEnable(deps, requireUser(req, { allowLimited: true }), code, ctxOf(deps, req)) };
  });

  // New set of recovery codes; the old ones stop working. Needs a current authenticator code.
  app.post('/api/v1/me/totp/recovery-codes', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { code } = codeSchema.parse(req.body);
    return { recovery_codes: await accounts.regenerateRecoveryCodes(deps, requireUser(req), code, ctxOf(deps, req)) };
  });

  // Export (docs/12): asking needs the password again; the archive is built by a worker and kept for 7 days.
  app.post('/api/v1/me/export', async (req, reply) =>
    reply.code(202).send(await exports_.requestExport(deps, requireUser(req), z.object({ password: z.string().max(200), include_private_key: z.boolean().default(false) }).parse(req.body), ctxOf(deps, req))));
  app.get('/api/v1/me/exports', async (req) => ({ exports: await exports_.listExports(deps, requireUser(req)) }));
  app.get('/api/v1/me/exports/:id/download', async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^x_[0-9A-Z]{26}$/) }).parse(req.params);
    const f = await exports_.downloadTarget(deps, requireUser(req), id, ctxOf(deps, req));
    return reply.type('application/zip').header('content-disposition', `attachment; filename="${f.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`)
      .header('content-length', f.size).header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').send(createReadStream(f.path));
  });

  // Bringing back an export (docs/12). The upload changes nothing; it returns a preview. Applying needs the password.
  app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: imports.importMaxBytes(deps) }, (_req, body, done) => done(null, body));
    scope.post('/api/v1/me/import', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
      if (req.body !== undefined && !Buffer.isBuffer(req.body)) throw new ApiError(400, 'bad_request', 'Send the zip file itself as the request body.');
      return imports.previewImport(deps, requireUser(req), (req.body as Buffer | undefined) ?? Buffer.alloc(0));
    });
  });
  app.post('/api/v1/me/import/:id/apply', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { id } = z.object({ id: z.string().regex(/^im_[0-9A-Z]{26}$/) }).parse(req.params);
    const body = z.object({ password: z.string().max(200), parts: z.array(z.enum(imports.IMPORT_PARTS)).min(1), replace_homepage: z.boolean().default(false) }).parse(req.body);
    return imports.applyImport(deps, requireUser(req), id, body, ctxOf(deps, req));
  });

  // Deleting the account (docs/12): as hard to do as logging in, and it cannot be undone.
  app.post('/api/v1/me/delete', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({
      password: z.string().max(200), confirm_handle: z.string().max(40), posts: z.enum(['keep', 'erase']),
      totp: z.string().regex(/^\d{6}$/).optional(), recovery_code: z.string().max(40).optional(),
    }).parse(req.body);
    await deleteOwnAccount(deps, requireUser(req), b, ctxOf(deps, req));
    return reply.clearCookie(COOKIE, { path: '/' }).code(204).send();
  });
}
