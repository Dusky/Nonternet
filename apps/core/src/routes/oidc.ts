import type { FastifyInstance } from 'fastify';
import type Provider from 'oidc-provider';
import { OIDC_PATH } from '../oidc/provider';
import type { AppDeps } from '../deps';

export function oidcRoutes(app: FastifyInstance, deps: AppDeps, provider: Provider): void {
  // Everything under /oidc belongs to the provider, which reads and answers the raw request itself.
  // It sits in its own scope so Fastify leaves the request body unread.
  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, _payload, done) => done(null));
    const handler = (req: { raw: { url?: string; originalUrl?: string } }, reply: { hijack(): void; raw: unknown }) => {
      // The provider works out its own prefix from originalUrl (it expects to be "mounted").
      req.raw.originalUrl = req.raw.url;
      req.raw.url = (req.raw.url ?? '/').slice(OIDC_PATH.length) || '/';
      reply.hijack();
      provider.callback()(req.raw as never, reply.raw as never);
    };
    scope.all(OIDC_PATH, handler as never);
    scope.all(`${OIDC_PATH}/*`, handler as never);
  });

  // The provider sends the browser here when it needs to know who is signing in. Signing in
  // happens on the site, not here: if the browser has a site session we confirm it to the
  // provider, and if not we send the user to the site's login page and back.
  app.get<{ Params: { uid: string } }>('/api/v1/oidc/interaction/:uid', async (req, reply) => {
    let details;
    try {
      details = await provider.interactionDetails(req.raw, reply.raw);
    } catch {
      return reply.code(400).send({ error: { code: 'interaction_expired', message: 'This sign-in expired. Go back to the app and start again.' } });
    }

    const user = req.session;
    if (!user || user.limited) {
      const back = `${deps.publicUrl}${req.raw.url}`;
      return reply.redirect(`${deps.publicUrl}/login?return_to=${encodeURIComponent(back)}`);
    }

    reply.hijack();
    try {
      if (details.prompt.name === 'login') {
        // Note: prompt=login and max_age from a client are not enforced. The site session is the
        // login, and there is no re-authentication step yet.
        await provider.interactionFinished(req.raw, reply.raw, { login: { accountId: user.userId } }, { mergeWithLastSubmission: false });
      } else if (details.prompt.name === 'consent') {
        // Every client is a first-party service, so there is no consent screen: grant what it asked for.
        const grant = details.grantId
          ? (await provider.Grant.find(details.grantId))!
          : new provider.Grant({ accountId: user.userId, clientId: details.params.client_id as string });
        const missing = details.prompt.details as { missingOIDCScope?: string[]; missingOIDCClaims?: string[]; missingResourceScopes?: Record<string, string[]> };
        if (missing.missingOIDCScope) grant.addOIDCScope(missing.missingOIDCScope.join(' '));
        if (missing.missingOIDCClaims) grant.addOIDCClaims(missing.missingOIDCClaims);
        for (const [resource, scopes] of Object.entries(missing.missingResourceScopes ?? {})) grant.addResourceScope(resource, scopes.join(' '));
        await provider.interactionFinished(req.raw, reply.raw, { consent: { grantId: await grant.save() } }, { mergeWithLastSubmission: true });
      } else {
        throw new Error(`unsupported prompt ${details.prompt.name}`);
      }
    } catch (err) {
      req.log.error({ err }, 'oidc interaction failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong. The admins have been notified.' } }));
      }
    }
  });
}
