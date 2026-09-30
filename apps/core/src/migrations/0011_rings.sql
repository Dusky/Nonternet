-- Rings (docs/06): small groups with their own board, a nav bar for members' homepages and ops.
CREATE TABLE rings (
  id text PRIMARY KEY,                                  -- r_…
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  about text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  founder_id text NOT NULL REFERENCES users (id),
  join_policy text NOT NULL CHECK (join_policy IN ('open', 'approval', 'invite')),
  board_id text REFERENCES boards (id),                 -- every ring has exactly one board, set as it is founded
  irc_channel text,                                     -- filled in when IRC ships
  archived_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rings_recent ON rings (created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX rings_tags ON rings USING gin (tags);

ALTER TABLE boards ADD CONSTRAINT boards_ring_fk FOREIGN KEY (ring_id) REFERENCES rings (id);

CREATE TABLE ring_members (
  ring_id text NOT NULL REFERENCES rings (id),
  user_id text NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('pending', 'invited', 'member', 'banned')),
  position integer NOT NULL,                            -- the order of the nav bar
  joined_at timestamptz NOT NULL DEFAULT now(),
  nav_detected_at timestamptz,                          -- last time the nav bar was seen running on their page
  PRIMARY KEY (ring_id, user_id)
);
CREATE INDEX ring_members_user ON ring_members (user_id, status);
CREATE INDEX ring_members_order ON ring_members (ring_id, position) WHERE status = 'member';

CREATE TABLE ring_bans (
  id bigserial PRIMARY KEY,
  ring_id text NOT NULL REFERENCES rings (id),
  user_id text NOT NULL REFERENCES users (id),
  reason text NOT NULL,
  by_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
