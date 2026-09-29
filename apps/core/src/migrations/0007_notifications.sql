-- Notifications (docs/05): someone replied to you, mentioned you, or started a thread on a board
-- you watch. One per person per post, written in the same transaction as the post.
CREATE TABLE notifications (
  id text PRIMARY KEY,                                  -- n_…
  user_id text NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('reply', 'mention', 'watch')),
  post_id text NOT NULL REFERENCES posts (id),
  board_id text NOT NULL REFERENCES boards (id),
  actor_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (user_id, post_id)
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
