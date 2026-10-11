-- Memos (docs/22): short notes in a timeline. Private for now; sharing, replies and reactions come in 0053.
CREATE TABLE memos (
  id text PRIMARY KEY,                                   -- mm_…
  user_id text NOT NULL REFERENCES users (id),
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'ring')),
  ring_id text REFERENCES rings (id),
  pinned boolean NOT NULL DEFAULT false,
  reply_to text REFERENCES memos (id) ON DELETE CASCADE,
  body_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  hidden_at timestamptz,
  hidden_reason text,
  CHECK ((visibility = 'ring') = (ring_id IS NOT NULL)),
  CHECK (reply_to IS NULL OR NOT pinned)
);
CREATE INDEX memos_user_recent ON memos (user_id, created_at DESC, id DESC) WHERE reply_to IS NULL;
CREATE INDEX memos_search ON memos USING gin (body_tsv);

CREATE TABLE memo_tags (
  memo_id text NOT NULL REFERENCES memos (id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (memo_id, tag)
);
CREATE INDEX memo_tags_tag ON memo_tags (tag);
