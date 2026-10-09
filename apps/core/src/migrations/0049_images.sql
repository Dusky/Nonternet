-- E6 (docs/23): pictures in posts and mail. The bytes live in <files dir>/images/<id>.webp.
CREATE TABLE images (
  id text PRIMARY KEY,                                  -- i_…
  owner_id text NOT NULL REFERENCES users (id),
  post_id text REFERENCES posts (id),                   -- set when a post uses it
  mail_message_id text REFERENCES mail_messages (id),   -- set when a mail message uses it
  alt text NOT NULL DEFAULT '',
  width integer NOT NULL,
  height integer NOT NULL,
  bytes integer NOT NULL,
  hidden_at timestamptz,                                -- an admin took it down (docs/03)
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (post_id IS NULL OR mail_message_id IS NULL)
);
CREATE INDEX images_owner ON images (owner_id);
CREATE INDEX images_post ON images (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX images_mail ON images (mail_message_id) WHERE mail_message_id IS NOT NULL;
CREATE INDEX images_unattached ON images (created_at) WHERE post_id IS NULL AND mail_message_id IS NULL;
