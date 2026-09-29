import type { FastifyReply, FastifyRequest } from 'fastify';
import { hashIp } from './crypto';
import type { Ctx, SessionUser } from './accounts';
import type { AppDeps } from './deps';
import { ApiError } from './errors';

declare module 'fastify' {
  interface FastifyRequest { session: SessionUser | null }
}

export const COOKIE = 'sid';

export const ctxOf = (deps: AppDeps, req: FastifyRequest): Ctx => ({
  ip: req.ip, ipHash: hashIp(deps.secretKey, req.ip), userAgent: req.headers['user-agent'],
});

export function setSessionCookie(deps: AppDeps, reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE, token, { httpOnly: true, secure: deps.secureCookies, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 });
}

// Guards. A limited session (admin who hasn't set up TOTP yet) only passes with allowLimited.
export function requireUser(req: FastifyRequest, opts: { allowLimited?: boolean } = {}): SessionUser {
  if (!req.session) throw new ApiError(401, 'unauthenticated', 'Log in to continue.');
  if (req.session.limited && !opts.allowLimited) {
    throw new ApiError(403, 'totp_setup_required', 'Set up two-factor authentication to continue.');
  }
  return req.session;
}
export function requireAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Only admins can do that.');
  return user;
}
