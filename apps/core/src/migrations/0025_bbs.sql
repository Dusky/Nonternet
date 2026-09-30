-- The BBS (docs/04, M8): it signs callers in through core, which gives it an ordinary session to call the
-- API with. SSH keys are managed on the web; last callers are kept for the menu.
ALTER TABLE terminal_tickets DROP CONSTRAINT terminal_tickets_service_check;
ALTER TABLE terminal_tickets ADD CONSTRAINT terminal_tickets_service_check CHECK (service IN ('irc', 'mud', 'bbs'));

ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'web' CHECK (kind IN ('web', 'bbs'));

CREATE TABLE ssh_keys (
  id text PRIMARY KEY,                                  -- sk_…
  user_id text NOT NULL REFERENCES users (id),
  name text NOT NULL,
  key_type text NOT NULL,                               -- ssh-ed25519, ecdsa-sha2-nistp256, ssh-rsa …
  public_key text NOT NULL,                             -- the base64 blob, as in authorized_keys
  fingerprint text NOT NULL UNIQUE,                     -- SHA256:… (one key belongs to one person)
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX ssh_keys_user ON ssh_keys (user_id);

CREATE TABLE bbs_calls (
  id text PRIMARY KEY,                                  -- bc_…
  user_id text NOT NULL REFERENCES users (id),
  node integer NOT NULL,
  via text NOT NULL CHECK (via IN ('telnet', 'ssh', 'web')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz
);
CREATE INDEX bbs_calls_recent ON bbs_calls (connected_at DESC);
