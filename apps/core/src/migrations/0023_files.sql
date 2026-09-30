-- File areas (docs/05, Q13: built on the web in M7): categories made by admins, files uploaded by trusted
-- users (or whoever the area allows), downloaded by anyone who can read the area.
CREATE TABLE file_areas (
  id text PRIMARY KEY,                                  -- fa_…
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members')),
  upload_role text NOT NULL DEFAULT 'trusted' CHECK (upload_role IN ('user', 'trusted', 'admin')),
  created_by text REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE files (
  id text PRIMARY KEY,                                  -- f_… (also the name on disk)
  area_id text NOT NULL REFERENCES file_areas (id),
  uploader_id text REFERENCES users (id),               -- NULL once the uploader's account is deleted
  name text NOT NULL,                                   -- the file name people download it as
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  downloads integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,                                -- hidden by an admin; the file stays until deleted
  hidden_reason text,
  deleted_at timestamptz                                -- deleted: the bytes are gone, the row is a tombstone
);
CREATE INDEX files_area ON files (area_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX files_uploader ON files (uploader_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX files_name_in_area ON files (area_id, lower(name)) WHERE deleted_at IS NULL;

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post', 'homepage', 'guestbook', 'mail_message', 'file'));
