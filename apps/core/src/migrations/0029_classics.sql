-- BBS classics (M9-E, docs/04, 05): a oneliners wall, numbered bulletins, and a voting booth. They live in core so the
-- terminal and the web show the same rows.

-- A line of up to 60 characters. One per person per hour (enforced in code, so a moderator can still hide one).
CREATE TABLE oneliners (
  id text PRIMARY KEY,                                  -- ol_…
  author_id text NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,
  hidden_by text REFERENCES users (id)
);
CREATE INDEX oneliners_recent ON oneliners (created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX oneliners_author ON oneliners (author_id, created_at DESC);

-- Notices written by admins, numbered in the order they went up. A site document, not a person's own writing.
CREATE TABLE bulletins (
  id text PRIMARY KEY,                                  -- bl_…
  number int GENERATED ALWAYS AS IDENTITY UNIQUE,
  title text NOT NULL,
  body text NOT NULL,
  author_id text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  hidden_at timestamptz
);
-- The highest bulletin number each person has read, so the newest one can be shown at login if it is new to them.
CREATE TABLE bulletin_seen (
  user_id text PRIMARY KEY REFERENCES users (id),
  number int NOT NULL
);

-- Questions put to the site. Admins and trusted people can ask; everyone confirmed can vote once.
CREATE TABLE polls (
  id text PRIMARY KEY,                                  -- pl_…
  question text NOT NULL,
  created_by text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closes_at timestamptz,
  hidden_at timestamptz
);
CREATE TABLE poll_options (
  id text PRIMARY KEY,                                  -- po_…
  poll_id text NOT NULL REFERENCES polls (id),
  label text NOT NULL,
  position int NOT NULL
);
CREATE TABLE poll_votes (
  poll_id text NOT NULL REFERENCES polls (id),
  user_id text NOT NULL REFERENCES users (id),
  option_id text NOT NULL REFERENCES poll_options (id),
  voted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);
