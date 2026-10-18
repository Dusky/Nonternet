-- Suspensions that end by themselves, and private admin notes on a person (docs/11, 17 2026-10-18).
ALTER TABLE users ADD COLUMN suspended_until timestamptz;
CREATE INDEX users_suspended_until ON users (suspended_until) WHERE suspended_until IS NOT NULL;

CREATE TABLE admin_notes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id text REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_notes_user ON admin_notes (user_id, created_at DESC);
