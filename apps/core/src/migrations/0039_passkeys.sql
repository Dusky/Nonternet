-- Passkeys (docs/02, decided 2026-10-05): sign in with a device instead of a password and code.
-- A passkey is tied to this site's address (its hostname); the browser will only offer it here.
CREATE TABLE webauthn_credentials (
  id text PRIMARY KEY,                       -- our own stable id (pk_…), used in the API and the export
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,        -- the authenticator's id for it, base64url
  public_key bytea NOT NULL,                 -- COSE public key; not a secret, but useless anywhere else
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  backed_up boolean NOT NULL DEFAULT false,  -- synced by a password manager or the platform
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX webauthn_credentials_user ON webauthn_credentials (user_id);

-- One-use challenges, five minutes each. Adding a passkey ties the challenge to the person; signing in has no
-- person yet, so the browser gets the challenge's id back and returns it with the answer.
CREATE TABLE webauthn_challenges (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('register', 'login')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX webauthn_challenges_expiry ON webauthn_challenges (expires_at);
