-- Private mail (docs/10, Q11 decided 2026-09-30): conversations between two people, or small groups up
-- to 10, on this site only.
CREATE TABLE mail_threads (
  id text PRIMARY KEY,                                  -- mt_…
  subject text NOT NULL,
  created_by text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_participants (
  thread_id text NOT NULL REFERENCES mail_threads (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id),
  joined_at timestamptz NOT NULL DEFAULT now(),         -- someone added later reads from here on
  left_at timestamptz,
  last_read_at timestamptz,
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX mail_participants_user ON mail_participants (user_id) WHERE left_at IS NULL;

CREATE TABLE mail_messages (
  id text PRIMARY KEY,                                  -- mm_…
  thread_id text NOT NULL REFERENCES mail_threads (id) ON DELETE CASCADE,
  author_id text REFERENCES users (id),                 -- null once the author's account is deleted
  kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'joined', 'left')),
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX mail_messages_thread ON mail_messages (thread_id, created_at, id);
CREATE INDEX mail_messages_author ON mail_messages (author_id);

-- Blocking someone: they can't start a conversation with you or add you to one, and you don't see
-- their messages in groups you share.
CREATE TABLE user_blocks (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_id),
  CHECK (user_id <> blocked_id)
);

-- A message can be reported; it goes to admins with only that message shown.
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'homepage', 'guestbook', 'mail_message'));
