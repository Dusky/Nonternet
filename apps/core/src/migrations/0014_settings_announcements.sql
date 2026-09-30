-- Versioned settings (docs/11): the site config file gives the starting values; an admin can change some
-- of them at run time. Every change is a row, so any earlier value can be brought back.
CREATE TABLE settings_current (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES users (id)
);
CREATE TABLE settings_history (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  version integer NOT NULL,
  value jsonb,                                          -- null means "back to the config file's value"
  previous jsonb,
  reason text NOT NULL,
  changed_by text REFERENCES users (id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_to integer,                               -- set when this change was a rollback to that version
  UNIQUE (key, version)
);

-- Announcements shown to everyone, for a stretch of time (docs/11).
CREATE TABLE announcements (
  id text PRIMARY KEY,                                  -- a_…
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning')),
  channels text[] NOT NULL DEFAULT '{shell}',           -- more arrive with the BBS, IRC and MUD
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX announcements_active ON announcements (starts_at, ends_at) WHERE archived_at IS NULL;
