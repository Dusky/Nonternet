-- Moderation (docs/03): locked threads, who removed a post, the mod log and reports.

ALTER TABLE posts ADD COLUMN locked_at timestamptz;           -- only set on the first post of a thread
ALTER TABLE posts ADD COLUMN deleted_by text CHECK (deleted_by IN ('author', 'moderator'));
UPDATE posts SET deleted_by = 'author' WHERE deleted_at IS NOT NULL;

-- What moderators did. Public per board (site setting), and never contains the removed text.
CREATE TABLE mod_actions (
  id text PRIMARY KEY,                                  -- m_…
  board_id text NOT NULL REFERENCES boards (id),
  actor_id text NOT NULL REFERENCES users (id),
  action text NOT NULL CHECK (action IN ('hide', 'unhide', 'lock', 'unlock', 'remove', 'move')),
  post_id text NOT NULL REFERENCES posts (id),
  reason text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  undone_by text REFERENCES users (id)
);
CREATE INDEX mod_actions_board ON mod_actions (board_id, created_at DESC, id DESC);

CREATE TABLE reports (
  id text PRIMARY KEY,                                  -- rp_…
  target_type text NOT NULL CHECK (target_type IN ('post')),
  target_id text NOT NULL,
  -- Who handles it first: the ops of this scope, then admins (docs/03).
  scope_type text NOT NULL CHECK (scope_type IN ('board')),
  scope_id text NOT NULL,
  reporter_id text NOT NULL REFERENCES users (id),
  category text NOT NULL CHECK (category IN ('spam', 'abuse', 'illegal', 'other')),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by text REFERENCES users (id),
  resolved_at timestamptz,
  resolution_note text
);
-- One open report per person per thing, so one person cannot flood a queue.
CREATE UNIQUE INDEX reports_one_open ON reports (reporter_id, target_type, target_id) WHERE status = 'open';
CREATE INDEX reports_scope ON reports (scope_type, scope_id, status, created_at);
