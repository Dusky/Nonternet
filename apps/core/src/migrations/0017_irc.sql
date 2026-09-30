-- IRC (docs/08). Ergo keeps its own accounts and channel registrations; core keeps what they should be
-- and a record of what it has already told Ergo, so the bot only sends the difference.

-- A separate password for native clients (docs/02): leaking it does not expose the web account.
ALTER TABLE users ADD COLUMN terminal_password_hash text;
ALTER TABLE users ADD COLUMN terminal_password_set_at timestamptz;

-- One-use tickets the Chat app presents as its SASL password. Only the hash is stored.
CREATE TABLE irc_tickets (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX irc_tickets_expiry ON irc_tickets (expires_at);

-- Registered channels besides ring channels (which follow the rings table).
CREATE TABLE irc_channels (
  name text PRIMARY KEY CHECK (name ~ '^#[a-z0-9][a-z0-9_-]{0,29}$'),
  kind text NOT NULL CHECK (kind IN ('official', 'user')),
  owner_id text REFERENCES users (id),                  -- set for kind = 'user'
  created_by text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CHECK ((kind = 'user') = (owner_id IS NOT NULL))
);
CREATE INDEX irc_channels_owner ON irc_channels (owner_id) WHERE removed_at IS NULL;

-- What the bot has applied in Ergo: kind 'channel' (key = channel), 'amode' (key = 'channel account',
-- value = mode letter), 'suspend' (key = account).
CREATE TABLE irc_applied (
  kind text NOT NULL,
  key text NOT NULL,
  value text NOT NULL DEFAULT '',
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);

-- Announcements can also go to the IRC lobby; this marks when they were sent there.
ALTER TABLE announcements ADD COLUMN irc_sent_at timestamptz;
