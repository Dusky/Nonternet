-- Accounts, sessions, invites, email verification and the audit log (docs/13).
-- Forward-only: never edit this file once released; add a new migration instead.

CREATE TABLE users (
  id text PRIMARY KEY,                                  -- u_…
  handle text NOT NULL,
  display_name text,
  bio text,
  email text NOT NULL,
  email_verified_at timestamptz,
  password_hash text NOT NULL,
  totp_secret_enc text,                                 -- AES-256-GCM, see crypto.ts
  totp_enabled_at timestamptz,
  role text NOT NULL DEFAULT 'guest' CHECK (role IN ('guest', 'user', 'trusted', 'admin')),
  role_rev integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_handle_lower ON users (lower(handle));
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE sessions (
  id text PRIMARY KEY,                                  -- s_…
  user_id text NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,                      -- sha256 of the cookie value; never the value
  user_agent text,
  ip_hash text,
  limited boolean NOT NULL DEFAULT false,               -- admin who must still set up TOTP
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE invites (
  code text PRIMARY KEY,
  created_by text NOT NULL REFERENCES users (id),
  used_by text REFERENCES users (id),
  used_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_verifications (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only. Milestone task 5 adds the DB-level INSERT-only grant and the read APIs.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id text,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system', 'cli')),
  action text NOT NULL,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  origin text NOT NULL,                                 -- web | cli | system (terminal, irc, mud later)
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_target ON audit_log (target_type, target_id);
CREATE INDEX audit_log_actor ON audit_log (actor_id);
