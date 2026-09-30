-- Ownership (docs/12): each person's Ed25519 key, and their export archives.
ALTER TABLE users ADD COLUMN public_key text;             -- PEM (SPKI)
ALTER TABLE users ADD COLUMN private_key_enc text;        -- PEM (PKCS8) encrypted with APP_SECRET_KEY, see crypto.ts

CREATE TABLE exports (
  id text PRIMARY KEY,                                  -- x_…
  user_id text NOT NULL REFERENCES users (id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  include_private_key boolean NOT NULL DEFAULT false,
  private_key_blob text,                                -- the private key, already locked with the person's chosen password
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ready_at timestamptz,
  expires_at timestamptz,
  size_bytes bigint,
  sha256 text,
  error text
);
CREATE INDEX exports_user ON exports (user_id, requested_at DESC);
CREATE INDEX exports_queue ON exports (requested_at) WHERE status = 'queued';
