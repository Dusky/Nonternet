-- Editing posts, pinned threads and reactions (M9-C, docs/05).

-- What a post said before each edit, newest last. The text is erased wherever the post's own text is erased
-- (the author deletes it, a moderator removes it, the account is erased), so editing never keeps what a
-- deletion was meant to take away.
CREATE TABLE post_revisions (
  id text PRIMARY KEY,                                  -- pr_…
  post_id text NOT NULL REFERENCES posts (id),
  editor_id text REFERENCES users (id),                 -- who made the edit (a moderator, or the author)
  subject text NOT NULL,
  body text NOT NULL,
  reason text,                                          -- a moderator's reason, shown with the history
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_revisions_post ON post_revisions (post_id, edited_at);

-- A pinned thread stays at the top of its board's list (up to 3 per board). Set on the thread's first post.
ALTER TABLE posts ADD COLUMN pinned_at timestamptz;
CREATE INDEX posts_pinned ON posts (board_id) WHERE pinned_at IS NOT NULL;

-- A small fixed set of reactions; one person can leave several different ones on a post, each once.
CREATE TABLE post_reactions (
  post_id text NOT NULL REFERENCES posts (id),
  user_id text NOT NULL REFERENCES users (id),
  reaction text NOT NULL CHECK (reaction IN ('agree', 'thanks', 'funny', 'interesting', 'sad', 'love')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, reaction)
);
CREATE INDEX post_reactions_user ON post_reactions (user_id);
