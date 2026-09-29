-- Boards and posts (docs/05, docs/13). Posts are plain UTF-8 text so the terminal BBS can show them.

CREATE TABLE board_categories (
  id text PRIMARY KEY,                                  -- bc_…
  name text NOT NULL UNIQUE,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE boards (
  id text PRIMARY KEY,                                  -- b_…
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category_id text REFERENCES board_categories (id),
  ring_id text,                                         -- no foreign key until rings exist (M3)
  owner_id text NOT NULL REFERENCES users (id),
  visibility text NOT NULL CHECK (visibility IN ('public', 'members', 'ring', 'private')),
  archived_at timestamptz,
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX boards_owner ON boards (owner_id) WHERE archived_at IS NULL;

CREATE TABLE board_members (
  board_id text NOT NULL REFERENCES boards (id),
  user_id text NOT NULL REFERENCES users (id),
  added_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE posts (
  id text PRIMARY KEY,                                  -- p_…
  -- Ordering and read pointers use seq, not the ID: ULIDs made in the same millisecond can
  -- come out in either order, a sequence cannot.
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  board_id text NOT NULL REFERENCES boards (id),
  author_id text REFERENCES users (id),
  thread_root_id text REFERENCES posts (id),            -- null on the post that starts a thread
  reply_to_id text REFERENCES posts (id),
  subject text NOT NULL,
  body text NOT NULL,
  body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', subject || ' ' || body)) STORED,
  posted_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  deleted_at timestamptz,
  -- Kept on the root post of a thread so the thread list is one indexed read.
  reply_count int NOT NULL DEFAULT 0,
  last_seq bigint,
  CHECK (thread_root_id IS NULL OR reply_to_id IS NOT NULL)
);
CREATE INDEX posts_thread ON posts (thread_root_id, seq);
CREATE INDEX posts_board_seq ON posts (board_id, seq);
CREATE INDEX posts_thread_list ON posts (board_id, last_seq DESC) WHERE thread_root_id IS NULL;
CREATE INDEX posts_author ON posts (author_id);
CREATE INDEX posts_search ON posts USING gin (body_tsv);

CREATE TABLE watches (
  user_id text NOT NULL REFERENCES users (id),
  board_id text NOT NULL REFERENCES boards (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id)
);

-- Read pointers. Unread counts are everything in the board after the pointer that is not yours.
CREATE TABLE read_state (
  user_id text NOT NULL REFERENCES users (id),
  board_id text NOT NULL REFERENCES boards (id),
  last_read_seq bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id)
);
