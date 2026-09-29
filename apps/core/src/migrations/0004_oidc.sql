-- OIDC provider storage (docs/02): the provider's own records, and its signing keys.

-- Every record the provider keeps (sessions, grants, codes, tokens, interactions). id + type is the
-- key. The extra columns exist so the provider can look records up and so we can revoke by user.
CREATE TABLE oidc_payloads (
  id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  grant_id text,
  user_code text,
  uid text,
  account_id text,                                      -- the user ID, so a suspension can revoke everything
  expires_at timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (id, type)
);
CREATE INDEX oidc_payloads_grant ON oidc_payloads (grant_id);
CREATE INDEX oidc_payloads_uid ON oidc_payloads (uid);
CREATE INDEX oidc_payloads_user_code ON oidc_payloads (user_code);
CREATE INDEX oidc_payloads_account ON oidc_payloads (account_id);
CREATE INDEX oidc_payloads_expires ON oidc_payloads (expires_at);

-- Signing keys. The private JWK is encrypted with APP_SECRET_KEY. The newest key signs; every key
-- stays in the published key set until it is deleted, so tokens signed by an older key still verify.
CREATE TABLE oidc_keys (
  kid text PRIMARY KEY,
  alg text NOT NULL,
  private_jwk_enc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
