import { hkdfSync } from 'node:crypto';
import { toPublicSite } from '@app/shared';
import { makeT } from '@app/strings';
import Provider, { interactionPolicy, type ClientMetadata, type Configuration } from 'oidc-provider';
import type { OidcClient } from '@app/shared';
import { opsFor, resolveSession } from '../accounts';
import type { AppDeps } from '../deps';
import { postgresAdapterFactory } from './adapter';
import { loadOrCreateKeys } from './keys';

export const OIDC_PATH = '/oidc';
export const ACCESS_TOKEN_SECONDS = 900; // 15 minutes (docs/02)

// A client from the site config, with its secret filled in from the environment.
export type ResolvedOidcClient = OidcClient & { secret?: string };

// Confidential clients authenticate with a secret that lives in the environment, never in the
// config file: OIDC_SECRET_<CLIENT_ID>, e.g. OIDC_SECRET_IRC_WEB for client "irc-web".
export const oidcSecretVar = (clientId: string): string => `OIDC_SECRET_${clientId.toUpperCase().replace(/-/g, '_')}`;

export function resolveOidcClients(clients: OidcClient[], env: Record<string, string | undefined>): ResolvedOidcClient[] {
  return clients.map((c) => {
    if (c.public) return c;
    const secret = env[oidcSecretVar(c.client_id)];
    if (!secret) throw new Error(`OIDC client "${c.client_id}" is confidential: set ${oidcSecretVar(c.client_id)} (at least 32 characters)`);
    if (secret.length < 32) throw new Error(`${oidcSecretVar(c.client_id)} must be at least 32 characters`);
    return { ...c, secret };
  });
}

const toClient = (c: ResolvedOidcClient): ClientMetadata => ({
  client_id: c.client_id,
  ...(c.public ? {} : { client_secret: c.secret }),
  redirect_uris: c.redirect_uris,
  post_logout_redirect_uris: c.post_logout_redirect_uris,
  token_endpoint_auth_method: c.public ? 'none' : 'client_secret_basic',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  id_token_signed_response_alg: 'ES256',
  application_type: 'web',
});

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function createOidcProvider(deps: AppDeps): Promise<Provider> {
  const t = makeT(toPublicSite(deps.config));
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main>${body}</main></body></html>`;
  const keys = await loadOrCreateKeys(deps.db, deps.secretKey);
  const cookieKey = Buffer.from(hkdfSync('sha256', deps.secretKey, '', 'oidc-cookies', 32)).toString('base64');

  // The provider keeps its own browser session, which can outlive the site session. Without this
  // check, someone who logs out of the site and lets another person log in on the same browser
  // would still be signed in to IRC and the rest as the first person. So a sign-in is confirmed
  // again whenever the site session is missing, limited, or a different account.
  const policy = interactionPolicy.base();
  policy.get('login')!.checks.add(new interactionPolicy.Check('site_session', 'the site session is missing or a different account', 'site_session_mismatch', async (ctx) => {
    const sid = ctx.cookies.get('sid', { signed: false });
    const site = sid ? await resolveSession(deps, sid) : null;
    return !site || site.limited || site.userId !== ctx.oidc.session?.accountId;
  }));

  const configuration: Configuration = {
    adapter: postgresAdapterFactory(deps.db),
    clients: deps.oidcClients.map(toClient),
    jwks: { keys: keys as never },
    cookies: { keys: [cookieKey] },
    // Claims from docs/02. `profile` and `site` are scopes a service asks for.
    scopes: ['openid', 'offline_access', 'profile', 'site'],
    claims: { openid: ['sub'], profile: ['handle', 'display_name'], site: ['role', 'role_rev', 'ops'] },
    // Put the claims in the ID token itself, so a service can verify them offline.
    conformIdTokenClaims: false,
    // Authorization code flow only. The implicit and hybrid flows are legacy and switched off.
    responseTypes: ['code'],
    // All clients are first-party services, and every client must use PKCE.
    pkce: { required: () => true },
    ttl: {
      AccessToken: ACCESS_TOKEN_SECONDS,
      IdToken: ACCESS_TOKEN_SECONDS,
      AuthorizationCode: 60,
      RefreshToken: 30 * 24 * 3600,
      Grant: 30 * 24 * 3600,
      Session: 30 * 24 * 3600,
      Interaction: 600,
    },
    rotateRefreshToken: () => true,
    features: {
      devInteractions: { enabled: false },
      introspection: { enabled: true },   // confidential clients only, by the library's rules
      revocation: { enabled: true },
      // Needed when a different person signs in on a browser the provider still has a session for:
      // the provider ends the old session through this endpoint first. It ends the provider's
      // browser session only; it does not sign anyone out of the site and does not revoke grants.
      rpInitiatedLogout: {
        enabled: true,
        logoutSource: async (ctx, form) => {
          ctx.body = page(t('oidc.logout.title'), `<p>${escapeHtml(t('oidc.logout.question'))}</p>${form}<script>document.forms[0].addEventListener('submit',function(){})</script>`
            .replace('</form>', `<button type="submit" name="logout" value="yes" autofocus>${escapeHtml(t('oidc.logout.button'))}</button></form>`));
        },
        postLogoutSuccessSource: async (ctx) => {
          ctx.body = page(t('oidc.logout.title'), `<p>${escapeHtml(t('oidc.logout.done'))}</p>`);
        },
      },
    },
    // A plain page in the site's voice. The error code is shown for whoever is debugging, and
    // nothing else from the error (no descriptions or stack traces) reaches the browser.
    renderError: async (ctx, out) => {
      ctx.type = 'html';
      ctx.body = page(t('oidc.error'), `<p>${escapeHtml(t('oidc.error'))}</p>${out.error ? `<p><small>${escapeHtml(String(out.error))}</small></p>` : ''}`);
    },
    interactions: { url: (_ctx, interaction) => `/api/v1/oidc/interaction/${interaction.uid}`, policy },
    async findAccount(_ctx, sub) {
      const r = await deps.db.query<{ id: string; handle: string; display_name: string | null; role: string; role_rev: number }>(
        `SELECT id, handle, display_name, role, role_rev FROM users WHERE id = $1 AND status = 'active'`, [sub]);
      const u = r.rows[0];
      if (!u) return undefined; // suspended or deleted: no new tokens, and refresh fails
      return {
        accountId: u.id,
        // Read fresh each time, so a role or ops change shows up at the next token or userinfo call.
        async claims() {
          return { sub: u.id, handle: u.handle, display_name: u.display_name, role: u.role, role_rev: u.role_rev, ops: await opsFor(deps.db, u.id) };
        },
      };
    },
  };

  const provider = new Provider(`${deps.publicUrl}${OIDC_PATH}`, configuration);
  provider.proxy = deps.trustProxy; // read X-Forwarded-Proto behind Caddy
  return provider;
}
