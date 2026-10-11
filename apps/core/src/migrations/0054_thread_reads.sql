-- Reading position per thread (2026-10-11): opening the newest thread no longer marks every older one read.
-- A post counts as read when it is at or below the board's pointer (moved by "mark all read") or the thread's own.
CREATE TABLE thread_reads (
  user_id text NOT NULL REFERENCES users (id),
  thread_id text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  last_read_seq bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);
