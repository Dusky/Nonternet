-- Guestbooks, hit counters and the reportable homepage things (docs/07).
ALTER TABLE homepages ADD COLUMN guestbook_mode text NOT NULL DEFAULT 'open' CHECK (guestbook_mode IN ('open', 'approval', 'off'));

CREATE TABLE guestbook_entries (
  id text PRIMARY KEY,                                  -- g_…
  home_user_id text NOT NULL REFERENCES users (id),     -- whose guestbook
  author_id text REFERENCES users (id),                 -- set when a signed-in person signed it
  name text NOT NULL,
  url text,
  message text NOT NULL,
  status text NOT NULL CHECK (status IN ('visible', 'pending', 'hidden')),
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guestbook_home ON guestbook_entries (home_user_id, status, created_at DESC, id DESC);
CREATE INDEX guestbook_ip ON guestbook_entries (ip_hash, created_at);

-- A visit counts once per visitor per day. The running total is kept apart so the daily records can be pruned.
CREATE TABLE home_hits (user_id text PRIMARY KEY REFERENCES users (id), total bigint NOT NULL DEFAULT 0);
CREATE TABLE home_hit_seen (
  user_id text NOT NULL REFERENCES users (id),
  day date NOT NULL,
  visitor_hash text NOT NULL,
  PRIMARY KEY (user_id, day, visitor_hash)
);

-- Reports can now be about a homepage or a guestbook entry. Those go to admins.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'homepage', 'guestbook'));
ALTER TABLE reports DROP CONSTRAINT reports_scope_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_scope_type_check CHECK (scope_type IN ('board', 'site'));
