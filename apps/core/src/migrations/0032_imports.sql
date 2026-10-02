-- Bringing back an export (docs/12, 2026-10-02). An uploaded archive waits an hour for the person to look at
-- the preview; applying it records what came back. The same archive can be applied once.
CREATE TABLE imports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  summary jsonb
);
CREATE INDEX imports_user ON imports (user_id, created_at DESC);
CREATE UNIQUE INDEX imports_applied_once ON imports (user_id, sha256) WHERE applied_at IS NOT NULL;
