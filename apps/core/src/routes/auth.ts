import type { FastifyInstance } from 'fastify';
import { forgotPasswordSchema, loginInputSchema, resetPasswordSchema, signupInputSchema } from '@app/shared';
import { z } from 'zod';
import * as accounts from '../accounts';
import { COOKIE, ctxOf, requireUser, setSessionCookie } from '../http';
import type { AppDeps } from '../deps';

const verifySchema = z.object({ token: z.string().min(10).max(200) });
const perIp = (max: number, timeWindow: string) => ({ rateLimit: { max, timeWindow } });

export function authRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/v1/auth/signup', { config: perIp(5, '1 hour') }, async (req, reply) => {
    const input = signupInputSchema.parse(req.body);
    const user = await accounts.signup(deps, input, ctxOf(deps, req));
    return reply.code(201).send({ id: user.id, handle: user.handle, message: 'Account created. Check your email to confirm your address.' });
  });

  app.post('/api/v1/auth/login', {
    config: {
      rateLimit: {
        max: 8, timeWindow: '1 minute', hook: 'preHandler',
        // Per address and account together, so one account can't be hammered from one place.
        keyGenerator: (req: { ip: string; body?: unknown }) => `${req.ip}:${String((req.body as { identifier?: string } | undefined)?.identifier ?? '').toLowerCase()}`,
      },
    },
  }, async (req, reply) => {
    const input = loginInputSchema.parse(req.body);
    const { token, user } = await accounts.login(deps, input, ctxOf(deps, req));
    setSessionCookie(deps, reply, token);
    return { user };
  });

  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.session) await accounts.logout(deps, req.session);
    reply.clearCookie(COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/verify-email', { config: perIp(20, '1 hour') }, async (req, reply) => {
    const { token } = verifySchema.parse(req.body);
    await accounts.verifyEmail(deps, token, ctxOf(deps, req));
    return reply.code(204).send();
  });

  // Always answers 204, whether or not the email has an account (no way to probe for accounts).
  app.post('/api/v1/auth/forgot-password', {
    config: {
      rateLimit: {
        max: 3, timeWindow: '1 hour', hook: 'preHandler',
        keyGenerator: (req: { ip: string; body?: unknown }) => `${req.ip}:${String((req.body as { email?: string } | undefined)?.email ?? '').toLowerCase()}`,
      },
    },
  }, async (req, reply) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    await accounts.forgotPassword(deps, email, ctxOf(deps, req), (err) => req.log.error({ err }, 'reset email failed'));
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/reset-password', { config: perIp(10, '1 hour') }, async (req, reply) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await accounts.resetPassword(deps, token, password, ctxOf(deps, req), (err) => req.log.error({ err }, 'password-changed email failed'));
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/resend-verification', { config: perIp(3, '1 hour') }, async (req, reply) => {
    await accounts.resendVerification(deps, requireUser(req, { allowLimited: true }));
    return reply.code(204).send();
  });
}
