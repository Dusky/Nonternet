-- E3a (docs/23): follow a single thread, and a board's rules text.
CREATE TABLE thread_follows (
  user_id text NOT NULL REFERENCES users (id),
  thread_id text NOT NULL REFERENCES posts (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX thread_follows_thread ON thread_follows (thread_id);

ALTER TABLE boards ADD COLUMN rules text NOT NULL DEFAULT '';
