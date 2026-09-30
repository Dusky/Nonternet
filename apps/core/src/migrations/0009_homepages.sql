-- Homepages (docs/07). The files live on disk under HOMES_DIR/{user_id}/; this is their summary.
CREATE TABLE homepages (
  user_id text PRIMARY KEY REFERENCES users (id),
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  file_count integer NOT NULL DEFAULT 0,
  has_index boolean NOT NULL DEFAULT false,
  last_updated_at timestamptz,
  hidden_at timestamptz,                                -- an admin hid it (docs/03)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX homepages_recent ON homepages (last_updated_at DESC) WHERE has_index AND hidden_at IS NULL;

-- Old handles keep working as redirects for 90 days after a rename (docs/07). Handle renames arrive
-- with the admin rename call; the homes server already reads this table.
CREATE TABLE handle_history (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  handle text NOT NULL,                                 -- lowercase
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX handle_history_lookup ON handle_history (handle, changed_at DESC);
