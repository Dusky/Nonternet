import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { toPublicSite } from '@app/shared';
import { ZodError } from 'zod';
import { resolveSession } from './accounts';
import type { AppDeps } from './deps';
import { ApiError } from './errors';
import { COOKIE } from './http';
import { createOidcProvider, OIDC_PATH } from './oidc/provider';
import { oidcRoutes } from './routes/oidc';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { boardRoutes } from './routes/boards';
import { moderationRoutes } from './routes/moderation';
import { homeRoutes } from './routes/homes';
import { widgetRoutes, WIDGET_API } from './routes/widgets';
import { ringRoutes } from './routes/rings';
import { settingsRoutes } from './routes/settings';
import { legalRoutes } from './routes/legal';
import { ircRoutes } from './routes/irc';
import { mudRoutes } from './routes/mud';
import { mailRoutes } from './routes/mail';
import { vouchRoutes } from './routes/vouches';
import { fileRoutes } from './routes/files';
import { consoleRoutes } from './routes/console';
import { bbsRoutes } from './routes/bbs';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: deps.trustProxy });

  await app.register(cookie);
  if (deps.rateLimit) await app.register(rateLimit, { global: false });

  // Clients often send Content-Type: application/json with no body (fetch does when a body is
  // omitted). Treat that as "no input" instead of rejecting it; bad JSON is still a 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      const err = new Error('Invalid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Errors are { error: { code, message } } (docs/14).
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    if (err instanceof ApiError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: { code: 'invalid_input', message: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input.' } });
    }
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' } });
    if (err.statusCode === 413) return reply.code(413).send({ error: { code: 'file_too_large', message: 'That is too large to send. Files can be up to the size shown in the studio.' } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: 'bad_request', message: 'The request could not be understood.' } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong. The admins have been notified.' } });
  });

  // CSRF: browsers always send Origin on cross-site POSTs. A state-changing request with an
  // Origin we don't recognise is refused, and so is a cookie-bearing one with no Origin at all.
  app.addHook('onRequest', async (req) => {
    if (!UNSAFE.has(req.method)) return;
    // The OIDC endpoints are called by services with their own credentials (client auth, PKCE), not
    // with a browser session cookie, and the provider protects its own forms.
    if (req.url === OIDC_PATH || req.url.startsWith(`${OIDC_PATH}/`)) return;
    // The public widget API answers any website and never reads a session (see routes/widgets.ts).
    if (req.url.startsWith(WIDGET_API)) return;
    const origin = req.headers.origin;
    if (origin ? !deps.allowedOrigins.includes(origin) : Boolean(req.cookies[COOKIE])) {
      throw new ApiError(403, 'bad_origin', 'This request did not come from the site.');
    }
  });

  // Attach the session (if any) to every request.
  app.decorateRequest('session', null);
  app.addHook('preHandler', async (req) => {
    const raw = req.cookies[COOKIE];
    req.session = raw ? await resolveSession(deps, raw) : null;
  });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => { await deps.db.query('SELECT 1'); return { status: 'ready' }; });
  app.get('/api/v1/site', async () => toPublicSite(deps.config));

  oidcRoutes(app, deps, await createOidcProvider(deps));
  authRoutes(app, deps);
  meRoutes(app, deps);
  adminRoutes(app, deps);
  boardRoutes(app, deps);
  moderationRoutes(app, deps);
  homeRoutes(app, deps);
  widgetRoutes(app, deps);
  ringRoutes(app, deps);
  settingsRoutes(app, deps);
  legalRoutes(app, deps);
  ircRoutes(app, deps);
  mudRoutes(app, deps);
  mailRoutes(app, deps);
  vouchRoutes(app, deps);
  fileRoutes(app, deps);
  consoleRoutes(app, deps);
  bbsRoutes(app, deps);
  return app;
}
